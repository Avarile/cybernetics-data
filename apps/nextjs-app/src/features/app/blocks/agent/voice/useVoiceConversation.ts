import type { ISearchPlanPart } from '@teable/openapi';
import { AGENT_DATA_PART } from '@teable/openapi';
import type { UIMessage } from 'ai';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isToolPart, waitingApprovals } from '../model/agent-request';
import { useAgentVoiceStore } from '../state/voice-store';
import { BrowserVoiceEngine } from './engines/browser-engine';
import { ElevenLabsEngine } from './engines/elevenlabs-engine';
import type { IEngineId, ISpeechEngine, ISpeechQueueState } from './speech-queue';
import { SpeechQueue } from './speech-queue';
import {
  buildSpeechScript,
  counted,
  defaultDescriber,
  defaultPointerText,
  listed,
  splitSentences,
} from './speech-script';
import type { ISpeechDescriber, ISpeechPointerKind, ISpeechSegment } from './speech-script';
import type { IListenerError, IListenerState } from './voice-listener';
import { speechRecognitionSupported, VoiceListener } from './voice-listener';

/** Listening resumes this long after the agent has stopped talking (voice design §5.5). */
export const RESUME_GRACE_MS = 400;

export type IVoicePhase =
  | 'off'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'searching'
  | 'working'
  | 'speaking'
  | 'approval'
  | 'paused';

/** Shown under the composer: a mic problem, or ElevenLabs chosen but not configured. */
export type IVoiceNotice = IListenerError | 'not-configured';

export interface IVoicePhaseInput {
  enabled: boolean;
  busy: boolean;
  speaking: boolean;
  toolRunning: boolean;
  awaitingApproval: boolean;
  hidden: boolean;
  listener: IListenerState;
  /** The table a running search is on (cockpit design §8). */
  searching?: string;
}

/** What the status line says (voice design §8, §9). */
export function voicePhase(s: IVoicePhaseInput): IVoicePhase {
  if (!s.enabled) return 'off';
  if (s.speaking) return 'speaking';
  if (s.busy && s.searching) return 'searching';
  if (s.busy) return s.toolRunning ? 'working' : 'thinking';
  if (s.awaitingApproval) return 'approval';
  if (s.hidden || s.listener.status === 'failed') return 'paused';
  return s.listener.draft || s.listener.interim ? 'hearing' : 'listening';
}

/** The switch cannot be turned off from the send until the reply has been spoken (D2). */
export const switchLocked = (s: { enabled: boolean; busy: boolean; speaking: boolean }) =>
  s.enabled && (s.busy || s.speaking);

const RUNNING_TOOL_STATES = new Set(['input-streaming', 'input-available']);

/** The table a search in this reply is running on, if one runs. */
export function searchingTable(message?: UIMessage): string | undefined {
  if (message?.role !== 'assistant') return undefined;
  for (const part of [...message.parts].reverse()) {
    if (part.type !== AGENT_DATA_PART.searchPlan) continue;
    const data = (part as { data?: ISearchPlanPart }).data;
    if (data?.status !== 'running') return undefined;
    const running =
      data.states.find((st) => st.status === 'running') ??
      data.states.find((st) => st.status === 'pending');
    return (
      data.plan.steps.find((st) => st.id === running?.stepId)?.table.name ??
      data.plan.steps[0]?.table.name
    );
  }
  return undefined;
}
const toolRunning = (message?: UIMessage) =>
  message?.role === 'assistant' &&
  message.parts.some((p) => isToolPart(p) && RUNNING_TOOL_STATES.has(p.state));

/** Fakes for tests. */
export interface IVoiceConversationDeps {
  lang?: string;
  createRecognition?: () => ISpeechRecognition | undefined;
  engines?: Record<IEngineId, ISpeechEngine>;
}

export interface IVoiceConversationOptions {
  messages: UIMessage[];
  busy: boolean;
  error?: Error;
  disabled?: boolean;
  send: (text: string) => void;
  deps?: IVoiceConversationDeps;
}

export interface IVoiceConversation {
  supported: boolean;
  enabled: boolean;
  lang: string;
  phase: IVoicePhase;
  /** The table a running search is on, for the status line. */
  searching?: string;
  /** On, and the agent is responding: the switch cannot be turned off (Stop can end it). */
  locked: boolean;
  listener: IListenerState;
  speech: ISpeechQueueState;
  notice?: IVoiceNotice;
  /** In the switch's click: `prefix` is the typed text, which starts the draft. */
  turnOn: (prefix?: string) => void;
  /** Returns the draft not sent, for the textarea; does nothing while locked. */
  turnOff: () => string;
  clear: () => void;
  sendNow: () => void;
  retry: () => void;
  /** Stop: nothing more of this reply is said. */
  stopSpeech: () => void;
  /**
   * Says a text that is not a reply, once per `id` (scope design §8.3: the agent's summary of a
   * record). Nothing happens with voice off.
   */
  say: (id: string, text: string) => void;
  tapToHear: () => void;
  browserVoices: () => Promise<SpeechSynthesisVoice[]>;
  previewVoice: (voice: SpeechSynthesisVoice) => void;
}

const browserLang = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

/**
 * Voice conversation for one chat view (voice design §4–§9): listens while the agent is quiet,
 * sends after the silence, speaks the reply, and pauses the mic while the agent talks.
 */
export function useVoiceConversation(options: IVoiceConversationOptions): IVoiceConversation {
  const { t } = useTranslation('common');
  const enabled = useAgentVoiceStore((s) => s.enabled);
  const choice = useAgentVoiceStore((s) => s.engine);
  const setEnabled = useAgentVoiceStore((s) => s.setEnabled);
  const [supported, setSupported] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [notice, setNotice] = useState<IVoiceNotice>();
  const sendRef = useRef(options.send);
  sendRef.current = options.send;
  /** The reply Stop silenced: what is left of it is never said. */
  const silencedRef = useRef<string>();

  const [voice] = useState(() => {
    const deps = options.deps ?? {};
    const lang = deps.lang ?? browserLang();
    const engines = deps.engines ?? {
      elevenlabs: new ElevenLabsEngine(),
      browser: new BrowserVoiceEngine(() => ({
        lang,
        voiceURI: useAgentVoiceStore.getState().browserVoiceURI,
      })),
    };
    const queue = new SpeechQueue({
      choice: useAgentVoiceStore.getState().engine,
      engines,
      onNotConfigured: () => setNotice('not-configured'),
    });
    const listener = new VoiceListener({
      lang,
      onSend: (text) => sendRef.current(text),
      onFatal: (error) => {
        useAgentVoiceStore.getState().setEnabled(false);
        setNotice(error);
      },
      createRecognition: deps.createRecognition,
    });
    return { lang, engines, queue, listener };
  });
  const { lang, engines, queue, listener } = voice;
  const listenerState = useSyncExternalStore(
    listener.subscribe,
    listener.getSnapshot,
    listener.getSnapshot
  );
  const speech = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  const pointer = useCallback(
    (kind: ISpeechPointerKind, count: number) =>
      t(`agent.voice.look.${kind}`, { count, defaultValue: defaultPointerText(kind, count) }),
    [t]
  );

  const describe = useMemo<ISpeechDescriber>(
    () => ({
      board: (found) =>
        t('agent.voice.look.board', {
          found: listed(found.map(counted), t('agent.voice.and', 'and')),
          defaultValue: defaultDescriber.board(found),
        }),
      empty: () => t('agent.voice.look.empty', { defaultValue: defaultDescriber.empty() }),
      choice: (question, labels) =>
        t('agent.voice.look.choice', {
          question,
          options:
            labels.length && labels.length <= 3
              ? `${listed(labels, t('agent.voice.or', 'or'))}?`
              : '',
          count: labels.length,
          defaultValue: defaultDescriber.choice(question, labels),
        }),
    }),
    [t]
  );

  const { busy, error, disabled } = options;
  const last = options.messages.at(-1);
  const failed = !busy && !!error;
  /** What the last message says: the reply, or the error pointer when no reply came. */
  const scriptOf = useCallback(
    (final: boolean): [string, ISpeechSegment[]] | undefined => {
      if (!last) return undefined;
      if (last.role === 'assistant') {
        return [last.id, buildSpeechScript(last, { final, error: failed, pointer, describe })];
      }
      return failed
        ? [last.id, [{ id: 'error', kind: 'pointer', text: pointer('error', 1) }]]
        : undefined;
    },
    [last, failed, pointer, describe]
  );

  const locked = switchLocked({ enabled, busy, speaking: speech.active });
  const awaitingApproval = !busy && waitingApprovals(last).length > 0;

  useEffect(() => {
    setSupported(!!options.deps?.createRecognition || speechRecognitionSupported());
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      listener.dispose();
      queue.dispose();
    },
    [listener, queue]
  );

  useEffect(() => queue.setChoice(choice), [queue, choice]);

  // voice already on when this chat opens (thread switch, /clear): listen, but stay quiet about
  // what was on screen; runs before the effect below that queues the reply
  useEffect(() => {
    if (!useAgentVoiceStore.getState().enabled) return;
    const script = scriptOf(true);
    if (script) queue.skip(...script);
    listener.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the reply as it streams: each segment is said once
  useEffect(() => {
    if (!enabled) return;
    const script = scriptOf(!busy);
    if (script && script[0] !== silencedRef.current) queue.enqueue(...script);
  }, [enabled, busy, scriptOf, queue]);

  // half-duplex: the mic is off while the agent responds, an approval waits or the page is hidden
  const holdMic = busy || speech.active || awaitingApproval || hidden;
  useEffect(() => {
    if (!enabled) return;
    if (holdMic) {
      listener.pause();
      return;
    }
    if (listenerState.status !== 'paused') return;
    const timer = setTimeout(() => listener.resume(), RESUME_GRACE_MS);
    return () => clearTimeout(timer);
  }, [enabled, holdMic, listenerState.status, listener]);

  // the agent was switched off or broke while voice was on
  useEffect(() => {
    if (!enabled || !disabled) return;
    listener.stop();
    queue.stop();
    setEnabled(false);
  }, [enabled, disabled, listener, queue, setEnabled]);

  const turnOn = (prefix = '') => {
    if (!supported || disabled) return;
    queue.unlock();
    setNotice(undefined);
    silencedRef.current = undefined;
    // a reply still streaming is spoken from its start (D3); one on screen already is not
    const script = busy ? undefined : scriptOf(true);
    if (script) queue.skip(...script);
    setEnabled(true);
    listener.start(prefix);
  };

  const turnOff = () => {
    if (locked) return '';
    const draft = listener.stop();
    queue.stop();
    setEnabled(false);
    return draft;
  };

  const stopSpeech = () => {
    silencedRef.current = last?.id;
    queue.stop();
  };
  const say = useCallback(
    (id: string, text: string) => {
      if (!enabled) return;
      const segments = splitSentences(text, true).map(
        (sentence, i): ISpeechSegment => ({ id: `s${i}`, kind: 'prose', text: sentence })
      );
      queue.enqueue(id, segments);
    },
    [enabled, queue]
  );

  // stable, so the picker can load voices in an effect
  const browser = engines.browser instanceof BrowserVoiceEngine ? engines.browser : undefined;
  const browserVoices = useCallback(() => browser?.voices() ?? Promise.resolve([]), [browser]);
  const previewVoice = useCallback(
    (v: SpeechSynthesisVoice) =>
      browser?.preview(t('agent.voice.settings.previewText', "Hello, I'm your agent."), v),
    [browser, t]
  );

  return {
    supported,
    enabled,
    lang,
    phase: voicePhase({
      enabled,
      busy,
      speaking: speech.active,
      toolRunning: toolRunning(last),
      awaitingApproval,
      hidden,
      listener: listenerState,
      searching: searchingTable(last),
    }),
    searching: searchingTable(last),
    locked,
    listener: listenerState,
    speech,
    notice: notice ?? (listenerState.status === 'failed' ? listenerState.error : undefined),
    turnOn,
    turnOff,
    clear: () => listener.clear(),
    sendNow: () => listener.sendNow(),
    retry: () => {
      setNotice(undefined);
      listener.resume();
    },
    stopSpeech,
    say,
    tapToHear: () => queue.resumeBlocked(),
    browserVoices,
    previewVoice,
  };
}

/* eslint-disable sonarjs/no-duplicate-string */
import type { UIMessage } from 'ai';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, userEvent } from '@/test-utils';
import { useAgentVoiceStore } from '../state/voice-store';
import { AgentComposer } from '../ui/ask/Composer';
import type { IEngineId, ISpeechEngine } from './speech-queue';
import type { IVoiceConversation, IVoiceConversationOptions } from './useVoiceConversation';
import {
  RESUME_GRACE_MS,
  switchLocked,
  useVoiceConversation,
  voicePhase,
} from './useVoiceConversation';
import type { IListenerState } from './voice-listener';
import { SILENCE_MS } from './voice-listener';

const quiet: IListenerState = { status: 'listening', draft: '', interim: '' };

describe('voice phase and lock', () => {
  const base = {
    enabled: true,
    busy: false,
    speaking: false,
    toolRunning: false,
    awaitingApproval: false,
    hidden: false,
    listener: quiet,
  };

  it('says what the conversation is doing', () => {
    expect(voicePhase({ ...base, enabled: false })).toBe('off');
    expect(voicePhase(base)).toBe('listening');
    expect(voicePhase({ ...base, listener: { ...quiet, interim: 'hel' } })).toBe('hearing');
    expect(voicePhase({ ...base, busy: true })).toBe('thinking');
    expect(voicePhase({ ...base, busy: true, toolRunning: true })).toBe('working');
    expect(voicePhase({ ...base, busy: true, speaking: true })).toBe('speaking');
    expect(voicePhase({ ...base, awaitingApproval: true })).toBe('approval');
    expect(voicePhase({ ...base, awaitingApproval: true, speaking: true })).toBe('speaking');
    expect(voicePhase({ ...base, hidden: true })).toBe('paused');
    expect(voicePhase({ ...base, listener: { ...quiet, status: 'failed' } })).toBe('paused');
  });

  it('locks the switch on from the send until the reply has been spoken', () => {
    expect(switchLocked({ enabled: true, busy: true, speaking: false })).toBe(true);
    expect(switchLocked({ enabled: true, busy: false, speaking: true })).toBe(true);
    expect(switchLocked({ enabled: true, busy: false, speaking: false })).toBe(false);
    expect(switchLocked({ enabled: false, busy: true, speaking: true })).toBe(false);
  });
});

/** A recognition the test speaks into. */
class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart = null;
  onend: ((ev: Event) => void) | null = null;
  onresult: ((ev: ISpeechRecognitionEvent) => void) | null = null;
  onerror: ((ev: ISpeechRecognitionErrorEvent) => void) | null = null;
  started = 0;
  active = false;
  start() {
    this.active = true;
    this.started++;
  }
  stop() {
    this.abort();
  }
  abort() {
    if (!this.active) return;
    this.active = false;
    this.onend?.(new Event('end'));
  }
  say(transcript: string) {
    const results = [Object.assign([{ transcript, confidence: 1 }], { isFinal: true })];
    this.onresult?.({ resultIndex: 0, results } as unknown as ISpeechRecognitionEvent);
  }
}

/** An engine whose speech lasts until `release()` (or Stop). */
const gatedEngine = (id: IEngineId) => {
  let release = () => undefined as void;
  let gate = Promise.resolve();
  const engine = {
    id,
    maxChars: 300,
    spoken: [] as string[],
    unlock: vi.fn(),
    stop: vi.fn(),
    hold() {
      gate = new Promise<void>((resolve) => (release = resolve));
    },
    release: () => release(),
    speak: async (text: string, signal: AbortSignal) => {
      engine.spoken.push(text);
      await Promise.race([
        gate,
        new Promise((resolve) => signal.addEventListener('abort', resolve)),
      ]);
    },
  };
  return engine;
};

const user = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
});
const reply = (id: string, ...parts: object[]): UIMessage =>
  ({ id, role: 'assistant', parts }) as unknown as UIMessage;
const text = (value: string, state: 'streaming' | 'done' = 'done') => ({
  type: 'text',
  text: value,
  state,
});

describe('useVoiceConversation', () => {
  let recognition: FakeRecognition;
  let engine: ReturnType<typeof gatedEngine>;
  let send: Mock<(text: string) => void>;

  const mount = (initial: Partial<IVoiceConversationOptions> = {}) => {
    const deps = {
      lang: 'en-US',
      createRecognition: () => recognition as unknown as ISpeechRecognition,
      engines: { elevenlabs: engine, browser: gatedEngine('browser') } as unknown as Record<
        IEngineId,
        ISpeechEngine
      >,
    };
    return renderHook(
      (props: Partial<IVoiceConversationOptions>) =>
        useVoiceConversation({ messages: [], busy: false, send, ...props, deps }),
      { initialProps: initial }
    );
  };
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    useAgentVoiceStore.setState({ enabled: false, engine: 'auto', browserVoiceURI: undefined });
    recognition = new FakeRecognition();
    engine = gatedEngine('elevenlabs');
    send = vi.fn<(text: string) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says a summary once per id, sentence by sentence, and nothing with voice off', async () => {
    const { result } = mount();
    act(() => result.current.say('summary:recA:v1:1', 'Deploy steps. Pull, then apply.'));
    await advance(10);
    expect(engine.spoken).toEqual([]);
    act(() => result.current.turnOn());
    act(() => result.current.say('summary:recA:v1:1', 'Deploy steps. Pull, then apply.'));
    await advance(10);
    act(() => result.current.say('summary:recA:v1:1', 'Deploy steps. Pull, then apply.'));
    await advance(10);
    expect(engine.spoken.join(' ')).toBe('Deploy steps. Pull, then apply.');
    // another opening says it again
    act(() => result.current.say('summary:recA:v1:2', 'Deploy steps.'));
    await advance(10);
    expect(engine.spoken.join(' ')).toBe('Deploy steps. Pull, then apply. Deploy steps.');
  });

  it('listens, sends after the silence, speaks the reply, then listens again', async () => {
    const { result, rerender } = mount();
    act(() => result.current.turnOn());
    expect(result.current.phase).toBe('listening');
    expect(engine.unlock).toHaveBeenCalled();
    expect(recognition.started).toBe(1);

    act(() => recognition.say('show me the top customers'));
    expect(result.current.phase).toBe('hearing');
    await advance(SILENCE_MS);
    expect(send).toHaveBeenCalledWith('show me the top customers');

    const asked = user('u1', 'show me the top customers');
    engine.hold();
    rerender({ messages: [asked], busy: true });
    expect(result.current.phase).toBe('thinking');
    expect(result.current.locked).toBe(true);

    rerender({
      messages: [asked, reply('a1', text('Here are your customers. Acme', 'streaming'))],
      busy: true,
    });
    await advance(0);
    expect(engine.spoken).toEqual(['Here are your customers.']);
    expect(result.current.phase).toBe('speaking');
    expect(result.current.turnOff()).toBe('');
    expect(useAgentVoiceStore.getState().enabled).toBe(true);

    const table = '| Name |\n|---|\n| Acme |';
    rerender({
      messages: [asked, reply('a1', text(`Here are your customers. Acme leads.\n\n${table}`))],
      busy: false,
    });
    expect(result.current.locked).toBe(true);
    engine.release();
    await advance(0);
    expect(engine.spoken).toEqual([
      'Here are your customers.',
      'Acme leads.',
      expect.stringContaining('table'),
    ]);
    expect(result.current.locked).toBe(false);
    expect(recognition.started).toBe(1);
    await advance(RESUME_GRACE_MS);
    expect(recognition.started).toBe(2);
    expect(result.current.phase).toBe('listening');
  });

  it('does not read out what was on screen before voice was turned on', async () => {
    const { result } = mount({ messages: [user('u1', 'hi'), reply('a1', text('Old reply.'))] });
    act(() => result.current.turnOn());
    await advance(0);
    expect(engine.spoken).toEqual([]);
  });

  it('Stop silences the rest of the reply and unlocks the switch', async () => {
    const asked = user('u1', 'go');
    const { result, rerender } = mount();
    act(() => result.current.turnOn());
    engine.hold();
    rerender({ messages: [asked, reply('a1', text('One. Two', 'streaming'))], busy: true });
    await advance(0);
    expect(engine.spoken).toEqual(['One.']);
    act(() => result.current.stopSpeech());
    rerender({ messages: [asked, reply('a1', text('One. Two. Three.'))], busy: false });
    await advance(0);
    expect(engine.spoken).toEqual(['One.']);
    expect(result.current.locked).toBe(false);
    expect(result.current.turnOff()).toBe('');
    expect(useAgentVoiceStore.getState().enabled).toBe(false);
  });

  it('keeps the mic off while an approval waits', async () => {
    const { result, rerender } = mount();
    act(() => result.current.turnOn());
    const ask = {
      type: 'tool-delete_records',
      toolCallId: 'c1',
      state: 'approval-requested',
      approval: { id: 'ap1' },
    };
    rerender({ messages: [user('u1', 'delete it'), reply('a1', text('I will.'), ask)] });
    await advance(0);
    expect(engine.spoken).toEqual(['I will.', expect.stringContaining('form')]);
    expect(result.current.phase).toBe('approval');
    expect(result.current.locked).toBe(false);
    await advance(RESUME_GRACE_MS * 3);
    expect(recognition.active).toBe(false);
  });

  it('turning off hands back what was heard', () => {
    const { result } = mount();
    act(() => result.current.turnOn('typed'));
    act(() => recognition.say('and spoken'));
    let draft = '';
    act(() => {
      draft = result.current.turnOff();
    });
    expect(draft).toBe('typed and spoken');
    expect(result.current.enabled).toBe(false);
  });
});

const fakeVoice = (over: Partial<IVoiceConversation> = {}): IVoiceConversation => ({
  supported: true,
  enabled: false,
  lang: 'en-US',
  phase: 'off',
  locked: false,
  listener: { status: 'off', draft: '', interim: '' },
  speech: { active: false, engine: 'elevenlabs', blocked: false },
  turnOn: vi.fn(),
  turnOff: vi.fn(() => 'left over'),
  clear: vi.fn(),
  sendNow: vi.fn(),
  retry: vi.fn(),
  stopSpeech: vi.fn(),
  say: vi.fn(),
  tapToHear: vi.fn(),
  browserVoices: vi.fn(async () => []),
  previewVoice: vi.fn(),
  ...over,
});

describe('composer with voice', () => {
  afterEach(cleanup);
  const props = {
    placeholder: 'Search',
    suggestionsFor: () => [],
    onSubmit: vi.fn(() => false),
    onIdle: vi.fn(),
    onPick: vi.fn(),
  };

  it('turns voice on with the typed text as the start of the draft', async () => {
    const voice = fakeVoice();
    render(<AgentComposer {...props} voice={voice} />);
    await userEvent.type(screen.getByRole('combobox'), 'typed words');
    await userEvent.click(screen.getByRole('switch'));
    expect(voice.turnOn).toHaveBeenCalledWith('typed words');
  });

  it('shows the transcript in voice mode, with Clear and Send now', async () => {
    const voice = fakeVoice({
      enabled: true,
      phase: 'hearing',
      listener: { status: 'listening', draft: 'show me', interim: 'the top', deadline: Date.now() },
    });
    render(<AgentComposer {...props} voice={voice} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('agent-voice-transcript')).toHaveTextContent('show me the top');
    await userEvent.click(screen.getByRole('button', { name: /send now/i }));
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(voice.sendNow).toHaveBeenCalled();
    expect(voice.clear).toHaveBeenCalled();
  });

  it('locks the switch while the agent speaks, with Stop to end it', async () => {
    const voice = fakeVoice({ enabled: true, phase: 'speaking', locked: true });
    render(<AgentComposer {...props} voice={voice} />);
    expect(screen.getByRole('switch')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(voice.stopSpeech).toHaveBeenCalled();
  });

  it('disables the switch without speech recognition', () => {
    render(<AgentComposer {...props} voice={fakeVoice({ supported: false })} />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('puts the draft back into the textarea when voice is turned off', async () => {
    const voice = fakeVoice({ enabled: true, phase: 'hearing' });
    const { rerender } = render(<AgentComposer {...props} voice={voice} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(voice.turnOff).toHaveBeenCalled();
    rerender(<AgentComposer {...props} voice={{ ...voice, enabled: false }} />);
    expect(screen.getByRole('combobox')).toHaveValue('left over');
  });

  it('shows a mic problem under the composer', () => {
    render(<AgentComposer {...props} voice={fakeVoice({ notice: 'blocked' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/microphone/i);
  });
});

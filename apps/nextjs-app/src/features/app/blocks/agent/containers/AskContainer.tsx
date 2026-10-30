import type { IClarifyOption } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { useAgentSkills, useAgentStatus } from '../hooks/useAgentData';
import { useAgentSession } from '../hooks/useAgentSession';
import { useSearchBoard } from '../hooks/useSearchBoard';
import { defaultLens } from '../model/lens';
import { choiceFor, matchOption, openClarify } from '../model/transcript';
import { useCockpitStore } from '../state/cockpit-store';
import { useAgentVoiceStore } from '../state/voice-store';
import { AgentComposer } from '../ui/ask/Composer';
import { Suggestions } from '../ui/ask/Suggestions';
import { Transcript } from '../ui/ask/Transcript';
import { LensKnobs } from '../ui/stage/StageHead';
import s from '../ui/theme/cockpit.module.css';
import p from '../ui/theme/panels.module.css';
import { useVoiceConversation } from '../voice/useVoiceConversation';

/**
 * The ask panel at the top of the rail (§5.5, §8; the cockpit's ASK panel): the conversation,
 * its plans, the answer's lens and the composer with voice. It enlarges to the middle of the
 * screen; Escape or the backdrop puts it back.
 */
export const AskContainer = ({
  onPick,
}: {
  onPick: (option: IClarifyOption, clarifyId: string) => void;
}) => {
  const { t } = useTranslation('common');
  const chat = useAgentSession();
  const { data: agent } = useAgentStatus();
  const { data: skills } = useAgentSkills(agent?.tables.agent_skills);
  const focus = useCockpitStore((st) => st.focus);
  const selectedSearch = useCockpitStore((st) => st.selectedSearch);
  const selectSearch = useCockpitStore((st) => st.selectSearch);
  const draft = useCockpitStore((st) => st.draft);
  const setDraft = useCockpitStore((st) => st.setDraft);
  const voiceOn = useAgentVoiceStore((st) => st.enabled);
  const [expanded, setExpanded] = useState(false);
  const { board } = useSearchBoard();
  const stage = useCockpitStore((st) => st.stage);
  const lens = useCockpitStore((st) => st.lens);
  const setLens = useCockpitStore((st) => st.setLens);
  const showLens = stage === 'search' && Boolean(board?.plan) && Boolean(board?.cards.length);
  const disabled = agent ? !agent.enabled || agent.status !== 'ok' : false;

  // the focus hint and voice ride along with every message (voice design §7.3)
  useEffect(() => {
    if (!chat.session) return;
    const { baseId, tableId, viewId, recordIds } = focus ?? {};
    chat.session.context = {
      ...(baseId ? { baseId } : {}),
      ...(tableId ? { tableId } : {}),
      ...(viewId ? { viewId } : {}),
      ...(recordIds?.length ? { recordIds } : {}),
      ...(voiceOn ? { voice: true } : {}),
    };
  }, [chat.session, focus, voiceOn]);

  /** Typed or spoken: an answer that names an option of the open question sends it as the choice. */
  const send = (text: string) => {
    selectSearch(undefined);
    const clarify = openClarify(chat.messages);
    const option = clarify && matchOption(clarify, text);
    void chat.send(text, option ? choiceFor(clarify.clarifyId, option) : undefined);
  };
  const voice = useVoiceConversation({
    messages: chat.messages,
    busy: chat.busy,
    error: chat.error,
    disabled,
    send,
  });
  /** Stop also ends what the agent is saying (voice design §4.2). */
  const stop = () => {
    voice.stopSpeech();
    return chat.stop();
  };
  const startNew = () => {
    selectSearch(undefined);
    chat.startNew();
  };

  // Escape puts the enlarged panel back before the cockpit's own keys see it
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  return (
    <>
      {expanded && (
        // the panel's ✕ and Escape do the same from the keyboard
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className={p.backdrop} onClick={() => setExpanded(false)} />
      )}
      <section
        className={`${p.panel} ${p.ask}`}
        data-expanded={expanded}
        aria-label={t('agent.cockpit.askLabel', 'Ask the agent')}
      >
        <h2>
          {t('agent.cockpit.ask', 'ASK THE AGENT')}
          <span>
            {chat.busy && <small>{t('agent.cockpit.working', 'WORKING')}</small>}
            <button type="button" className={s.knob} onClick={() => void stop().then(startNew)}>
              {t('agent.cockpit.new', 'NEW')}
            </button>
            <button
              type="button"
              className={s.knob}
              aria-pressed={expanded}
              aria-label={
                expanded
                  ? t('agent.cockpit.collapse', 'Put the panel back')
                  : t('agent.cockpit.expand', 'Enlarge the panel')
              }
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '✕' : '⤢'}
            </button>
          </span>
        </h2>
        <Transcript
          messages={chat.messages}
          busy={chat.busy}
          error={chat.error}
          selectedSearch={selectedSearch}
          boards={chat.session?.boards}
          onSelectSearch={selectSearch}
          onRespond={(id, approved) => void chat.respond(id, approved)}
          onPick={onPick}
        />
        {showLens && board && (
          <div className={s.lensRow}>
            <LensKnobs
              mode={lens ?? defaultLens(board)}
              cited={board.lens.length}
              found={board.cards.length}
              onLens={setLens}
            />
          </div>
        )}
        {chat.messages.length === 0 && !disabled && (
          <div className={s.lensRow}>
            <Suggestions onAsk={send} />
          </div>
        )}
        <div className={s.composer}>
          <AgentComposer
            busy={chat.busy}
            disabled={disabled || chat.loading}
            skills={skills}
            voice={voice}
            onSend={send}
            onStop={() => void stop()}
            onClear={() => void stop().then(startNew)}
            draft={draft}
            onDraftTaken={() => setDraft(undefined)}
          />
        </div>
      </section>
    </>
  );
};

import type { IClarifyOption } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { useAgentSkills, useAgentStatus } from '../hooks/useAgentData';
import { useAgentSession } from '../hooks/useAgentSession';
import { useCockpitStore } from '../state/cockpit-store';
import { useAgentVoiceStore } from '../state/voice-store';
import { AgentComposer } from '../ui/ask/Composer';
import { Suggestions } from '../ui/ask/Suggestions';
import { Transcript } from '../ui/ask/Transcript';
import s from '../ui/theme/cockpit.module.css';
import { useVoiceConversation } from '../voice/useVoiceConversation';

/** The ask rail: the conversation, its plans and the composer with voice (§5.5, §8). */
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
  const voiceOn = useAgentVoiceStore((st) => st.enabled);
  const [sheet, setSheet] = useState<'open' | 'closed'>('open');
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

  const send = (text: string) => {
    selectSearch(undefined);
    void chat.send(text);
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

  return (
    <aside
      className={`${s.panel} ${s.rail}`}
      data-sheet={sheet}
      aria-label={t('agent.cockpit.askLabel', 'Ask the agent')}
    >
      <h2>
        {t('agent.cockpit.ask', 'ASK THE AGENT')}
        <small>{chat.busy ? t('agent.cockpit.working', 'WORKING') : ''}</small>
        <button
          type="button"
          className={s.knob}
          onClick={() => void stop().then(startNew)}
          style={{ marginLeft: 'auto' }}
        >
          {t('agent.cockpit.new', 'NEW')}
        </button>
        <button
          type="button"
          className={`${s.knob} ${s.sheetToggle}`}
          aria-expanded={sheet === 'open'}
          onClick={() => setSheet(sheet === 'open' ? 'closed' : 'open')}
        >
          {sheet === 'open' ? '▾' : '▴'}
        </button>
      </h2>
      <Transcript
        messages={chat.messages}
        busy={chat.busy}
        error={chat.error}
        selectedSearch={selectedSearch}
        onSelectSearch={selectSearch}
        onRespond={(id, approved) => void chat.respond(id, approved)}
        onPick={onPick}
      />
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
        />
      </div>
    </aside>
  );
};

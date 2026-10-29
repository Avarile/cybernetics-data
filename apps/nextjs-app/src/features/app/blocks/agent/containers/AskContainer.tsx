import { useEffect } from 'react';
import { useAgentSkills, useAgentStatus } from '../hooks/useAgentData';
import { useAgentSession } from '../hooks/useAgentSession';
import { useCockpitStore } from '../state/cockpit-store';
import { useAgentVoiceStore } from '../state/voice-store';
import { AgentComposer } from '../ui/ask/Composer';
import { Transcript } from '../ui/ask/Transcript';
import { useVoiceConversation } from '../voice/useVoiceConversation';

/** The conversation and the composer, with voice (cockpit design §5.5, §8). */
export const AskContainer = () => {
  const chat = useAgentSession();
  const { data: agent } = useAgentStatus();
  const { data: skills } = useAgentSkills(agent?.tables.agent_skills);
  const focus = useCockpitStore((s) => s.focus);
  const voiceOn = useAgentVoiceStore((s) => s.enabled);
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

  const send = (text: string) => void chat.send(text);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Transcript
        messages={chat.messages}
        busy={chat.busy}
        error={chat.error}
        onRespond={(id, approved) => void chat.respond(id, approved)}
      />
      <AgentComposer
        busy={chat.busy}
        disabled={disabled || chat.loading}
        skills={skills}
        voice={voice}
        onSend={send}
        onStop={() => void stop()}
        onClear={() => void stop().then(chat.startNew)}
      />
    </div>
  );
};

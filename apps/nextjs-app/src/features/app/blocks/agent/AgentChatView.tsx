import type { IAgentChatContext } from '@teable/openapi';
import type { UIMessage } from 'ai';
import { Bot } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useRef } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { AgentComposer, type IAgentSkillOption } from './components/AgentComposer';
import { AgentMessageView } from './components/AgentMessageView';
import { useAgentChat } from './useAgentChat';
import { useThreadMessages } from './useAgentData';
import { useVoiceConversation } from './voice/useVoiceConversation';

export interface IAgentChatViewProps {
  threadId?: string;
  initialMessages?: UIMessage[];
  context?: IAgentChatContext;
  skills?: IAgentSkillOption[];
  disabled?: boolean;
  onThread?: (threadId: string) => void;
  onTurnFinished?: () => void;
  /** `/clear`: the reply (if any) stops and the caller starts a new conversation. */
  onClear?: () => void;
}

/** The conversation and the composer; shared by the side panel and the /agent page. */
export const AgentChatView = ({
  threadId,
  initialMessages,
  context,
  skills,
  disabled,
  onThread,
  onTurnFinished,
  onClear,
}: IAgentChatViewProps) => {
  const { t } = useTranslation('common');
  const chat = useAgentChat({ threadId, initialMessages, context, onThread });
  const busy = chat.status === 'submitted' || chat.status === 'streaming';
  const respond = (approvalId: string, approved: boolean) => {
    void chat.respond(approvalId, approved).then(onTurnFinished);
  };
  const send = (text: string) => void chat.send(text).then(onTurnFinished);
  const voice = useVoiceConversation({
    messages: chat.messages,
    busy,
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
      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
          {chat.messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Bot className="size-8" />}
              title={t('agent.empty.title', 'Ask the agent')}
              description={t(
                'agent.empty.description',
                'It can read and change data in every space, remember things and use skills. Changes that matter wait for your approval.'
              )}
            />
          ) : (
            chat.messages.map((m, i) => (
              <AgentMessageView
                key={m.id}
                message={m}
                streaming={busy && i === chat.messages.length - 1}
                onRespond={respond}
              />
            ))
          )}
          {chat.error && (
            <div role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
              {chat.error.message}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <AgentComposer
        busy={busy}
        disabled={disabled}
        skills={skills}
        voice={voice}
        onSend={send}
        onStop={() => void stop()}
        onClear={onClear && (() => void stop().then(onClear))}
      />
    </div>
  );
};

/**
 * The chat of a stored thread (or a new one): its messages are fetched fresh when it mounts, and
 * the chat starts from that snapshot, so later refetches never reset a conversation in progress.
 */
export const AgentThreadChat = (props: Omit<IAgentChatViewProps, 'initialMessages'>) => {
  const history = useThreadMessages(props.threadId);
  const snapshot = useRef<UIMessage[]>();
  if (!snapshot.current) {
    if (!props.threadId || history.isError) snapshot.current = [];
    else if (history.isFetchedAfterMount) snapshot.current = history.data ?? [];
  }
  if (!snapshot.current) return <div className="flex-1" />;
  return <AgentChatView {...props} initialMessages={snapshot.current} />;
};

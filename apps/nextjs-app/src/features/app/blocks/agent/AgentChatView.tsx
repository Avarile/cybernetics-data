import type { IAgentChatContext } from '@teable/openapi';
import type { UIMessage } from 'ai';
import { Bot } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { AgentComposer, type IAgentSkillOption } from './components/AgentComposer';
import { AgentMessageView } from './components/AgentMessageView';
import { useAgentChat } from './useAgentChat';

export interface IAgentChatViewProps {
  threadId?: string;
  initialMessages?: UIMessage[];
  context?: IAgentChatContext;
  skills?: IAgentSkillOption[];
  disabled?: boolean;
  onThread?: (threadId: string) => void;
  onTurnFinished?: () => void;
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
}: IAgentChatViewProps) => {
  const { t } = useTranslation('common');
  const chat = useAgentChat({ threadId, initialMessages, context, onThread });
  const busy = chat.status === 'submitted' || chat.status === 'streaming';
  const respond = (approvalId: string, approved: boolean) => {
    void chat.respond(approvalId, approved).then(onTurnFinished);
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
        onSend={(text) => void chat.send(text).then(onTurnFinished)}
        onStop={() => void chat.stop()}
      />
    </div>
  );
};

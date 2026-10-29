import type { UIMessage } from 'ai';
import { Bot } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { AgentMessageView } from './MessageView';

export interface ITranscriptProps {
  messages: UIMessage[];
  busy: boolean;
  error?: Error;
  onRespond: (approvalId: string, approved: boolean) => void;
}

/** The thread's messages, newest at the bottom, following the reply as it streams. */
export const Transcript = ({ messages, busy, error, onRespond }: ITranscriptProps) => {
  const { t } = useTranslation('common');
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent>
        {messages.length === 0 ? (
          <ConversationEmptyState
            icon={<Bot className="size-8" />}
            title={t('agent.empty.title', 'Ask the agent')}
            description={t(
              'agent.empty.description',
              'It can read and change data in every space, remember things and use skills. Changes that matter wait for your approval.'
            )}
          />
        ) : (
          messages.map((m, i) => (
            <AgentMessageView
              key={m.id}
              message={m}
              streaming={busy && i === messages.length - 1}
              onRespond={onRespond}
            />
          ))
        )}
        {error && (
          <div role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {error.message}
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
};

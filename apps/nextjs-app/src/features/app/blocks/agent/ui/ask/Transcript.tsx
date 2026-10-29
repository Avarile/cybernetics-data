import type { IClarifyOption } from '@teable/openapi';
import type { UIMessage } from 'ai';
import { useTranslation } from 'next-i18next';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { MessageResponse } from '@/components/ai-elements/message';
import { transcriptOf } from '../../model/transcript';
import s from '../theme/cockpit.module.css';
import { ClarifyCard } from './ClarifyCard';
import { PlanLegs } from './PlanLegs';
import { AgentToolStep } from './ToolStep';

export interface ITranscriptProps {
  messages: UIMessage[];
  busy: boolean;
  error?: Error;
  selectedSearch?: string;
  onSelectSearch: (searchId: string) => void;
  onRespond: (approvalId: string, approved: boolean) => void;
  onPick: (option: IClarifyOption, clarifyId: string) => void;
}

/** The conversation in the ask rail (cockpit design §5.5): questions, plans, answers. */
export const Transcript = ({
  messages,
  busy,
  error,
  selectedSearch,
  onSelectSearch,
  onRespond,
  onPick,
}: ITranscriptProps) => {
  const { t } = useTranslation('common');
  return (
    <Conversation className="min-h-0 flex-1" role="log">
      <ConversationContent className={s.transcript}>
        {messages.length === 0 && (
          <p className={s.empty}>
            {t(
              'agent.empty.description',
              'It can read and change data in every space, remember things and use skills. Changes that matter wait for your approval.'
            )}
          </p>
        )}
        {messages.map((m, mi) => {
          const last = mi === messages.length - 1;
          const items = transcriptOf(m, { streaming: busy && last, answered: !last });
          return items.map((item) => {
            switch (item.kind) {
              case 'question':
                return (
                  <div key={item.key} className={s.question}>
                    {item.text}
                    {item.choice?.recordRef && (
                      <small>
                        {t('agent.cockpit.picked', 'picked')} {item.choice.recordRef.table} ·{' '}
                        {item.choice.label}
                      </small>
                    )}
                  </div>
                );
              case 'text':
                return (
                  <div key={item.key} className={s.answer}>
                    <MessageResponse>{item.text}</MessageResponse>
                  </div>
                );
              case 'reasoning':
                return (
                  <details key={item.key} className={s.reasoning} open={item.streaming}>
                    <summary>{t('agent.cockpit.thinking', 'THINKING')}</summary>
                    {item.text}
                  </details>
                );
              case 'plan':
                return (
                  <PlanLegs
                    key={item.key}
                    part={item.part}
                    selected={selectedSearch === item.part.searchId}
                    onSelect={() => onSelectSearch(item.part.searchId)}
                  />
                );
              case 'clarify':
                return (
                  <ClarifyCard
                    key={item.key}
                    part={item.part}
                    answered={item.answered || busy}
                    onPick={(o) => onPick(o, item.part.clarifyId)}
                  />
                );
              case 'tool':
                return (
                  <AgentToolStep
                    key={item.key}
                    part={item.part}
                    busy={busy && last}
                    onRespond={onRespond}
                  />
                );
            }
          });
        })}
        {error && (
          <div role="alert" className={s.error}>
            {error.message}
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
};

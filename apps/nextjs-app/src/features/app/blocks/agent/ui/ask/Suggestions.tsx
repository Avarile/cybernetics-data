import { useTranslation } from 'next-i18next';
import s from '../theme/cockpit.module.css';

/** Questions to start with, one per kind of search (cockpit design §5.5). */
export const Suggestions = ({ onAsk }: { onAsk: (text: string) => void }) => {
  const { t } = useTranslation('common');
  const questions = [
    t('agent.cockpit.suggest.project', 'How is my latest project going?'),
    t('agent.cockpit.suggest.tasks', 'Which tasks are in progress, and who is on them?'),
    t('agent.cockpit.suggest.knowledge', 'What do I have written about deployment?'),
    t('agent.cockpit.suggest.money', 'How much did I spend in the last 30 days?'),
  ];
  return (
    <div className={s.chips}>
      {questions.map((q) => (
        <button key={q} type="button" className={s.chipQ} onClick={() => onAsk(q)}>
          {q}
        </button>
      ))}
    </div>
  );
};

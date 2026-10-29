import type { IClarifyOption, IClarifyPart } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import s from '../theme/cockpit.module.css';

/**
 * The agent asks before it goes on (cockpit design §6.4): the question and up to six options.
 * Picking one sends it as the admin's answer; typing or saying an answer works too.
 */
export const ClarifyCard = ({
  part,
  answered,
  onPick,
}: {
  part: IClarifyPart;
  answered: boolean;
  onPick: (option: IClarifyOption) => void;
}) => {
  const { t } = useTranslation('common');
  return (
    <div
      className={s.clarify}
      role="group"
      aria-label={t('agent.cockpit.question', 'The agent asks')}
    >
      <p>{part.question}</p>
      {part.options.length > 0 && (
        <div className={s.options}>
          {part.options.map((o) => (
            <button key={o.id} type="button" disabled={answered} onClick={() => onPick(o)}>
              <span>{o.label}</span>
              {(o.detail || o.recordRef) && <small>{o.detail ?? o.recordRef?.table}</small>}
            </button>
          ))}
        </div>
      )}
      {!answered && (
        <span className={s.hint}>{t('agent.cockpit.orType', 'Or type or say your answer.')}</span>
      )}
    </div>
  );
};

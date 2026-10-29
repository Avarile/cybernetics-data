import type { ISearchPlanPart, IStepStatus } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { sourceText } from '../../model/search-board';
import s from '../theme/cockpit.module.css';

const mark: Record<IStepStatus, [string, string]> = {
  pending: ['·', 'dim'],
  running: ['▶', 'route'],
  done: ['✓', 'ink'],
  empty: ['0', 'dim'],
  needs_choice: ['?', 'caution'],
  skipped: ['–', 'faint'],
  failed: ['✕', 'caution'],
  cancelled: ['■', 'faint'],
};

/**
 * A search plan as an FMS legs page (cockpit design §5.5): one line per step with its table,
 * how it is reached, and its count. Clicking it puts that search on the stage.
 */
export const PlanLegs = ({
  part,
  selected,
  onSelect,
}: {
  part: ISearchPlanPart;
  selected: boolean;
  onSelect: () => void;
}) => {
  const { t } = useTranslation('common');
  const states = new Map(part.states.map((st) => [st.stepId, st]));
  return (
    <ol className={s.legs} aria-label={t('agent.cockpit.planLabel', 'Search plan')}>
      <header
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      >
        <span>
          {t('agent.cockpit.plan', 'PLAN')} · {part.plan.intent.replace(/_/g, ' ').toUpperCase()}
        </span>
        <span>{part.status.toUpperCase()}</span>
      </header>
      {part.plan.steps.map((step, i) => {
        const st = states.get(step.id);
        const [sym, tone] = mark[st?.status ?? 'pending'];
        return (
          <li key={step.id}>
            <span className={s.no}>{String(i + 1).padStart(2, '0')}</span>
            <span className={s.tbl}>
              {step.table.name}
              <small>{sourceText(part.plan, step.id)}</small>
            </span>
            <span className={s.st} data-tone={tone} data-status={st?.status}>
              {sym} {st && st.status !== 'pending' ? st.found : ''}
            </span>
          </li>
        );
      })}
      {part.plan.missing.length > 0 && (
        <div className={s.missing}>
          {t('agent.cockpit.missing', 'Not in this base')}: {part.plan.missing.join(', ')}
        </div>
      )}
    </ol>
  );
};

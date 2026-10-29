import type { ISearchPlan } from '@teable/openapi';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import type { IMetric } from '../../model/metrics';
import s from '../theme/cockpit.module.css';

/** The stage's corner readout: what was asked, and the numbers of the board (§5.6). */
export const Readout = ({
  plan,
  metrics,
  lensLabel,
}: {
  plan?: ISearchPlan;
  metrics: IMetric[];
  lensLabel: string;
}) => {
  const { t } = useTranslation('common');
  return (
    <div className={s.readout} aria-live="polite">
      <span className={s.top}>
        {(plan?.intent ?? '').replace(/_/g, ' ').toUpperCase()} · {lensLabel}
      </span>
      <span className={s.title}>{plan?.summary}</span>
      {plan?.missing.length ? (
        <span className={s.note}>
          {t('agent.cockpit.missing', 'Not in this base')}: {plan.missing.join(', ')}
        </span>
      ) : null}
      <dl className={s.kpis}>
        {metrics.map((m) => (
          <div key={m.k} data-tone={m.tone}>
            <dt>{m.k}</dt>
            <dd>
              {m.v}
              {m.s && <small>{m.s}</small>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

const legend: [string, string, string?][] = [
  ['route', 'IN PROGRESS', 'hatch'],
  ['target', 'NEXT · TODO'],
  ['ink', 'DONE'],
  ['dim', 'BACKLOG'],
  ['caution', 'ON HOLD · OVERDUE', 'halo'],
  ['faint', 'CANCELLED · ARCHIVED'],
];

export const Legend = () => (
  <div className={s.legend} aria-label="Legend">
    {legend.map(([tone, label, mark]) => (
      <span key={tone}>
        <i className={s.sym} data-tone={tone} data-mark={mark} aria-hidden />
        {label}
      </span>
    ))}
  </div>
);

/** The stage before any search: what to ask, or why the agent cannot answer yet. */
export const StandbyStage = ({ blocked, onLeave }: { blocked?: string; onLeave?: () => void }) => {
  const { t } = useTranslation('common');
  return (
    <div className={s.standby}>
      <b>{t('agent.cockpit.standby', 'STANDBY')}</b>
      {blocked ? (
        <>
          <span>{blocked}</span>
          <Link href="/admin/agent" onClick={onLeave}>
            {t('agent.panel.openSettings', 'Open Admin ▸ Agent')}
          </Link>
        </>
      ) : (
        <span>
          {t(
            'agent.cockpit.standbyText',
            'Ask about your work, knowledge or money. The agent plans a search table by table, and every record it finds lands here as a card.'
          )}
        </span>
      )}
    </div>
  );
};

import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import type { IMetric } from '../../model/metrics';
import s from '../theme/cockpit.module.css';

/**
 * The stage's corner readout (cockpit design §5.6, overview design §4.2): what is on the stage,
 * a title, notes (the render budget, what the base lacks) and the numbers.
 */
export const Readout = ({
  top,
  title,
  notes = [],
  metrics,
  live = 'polite',
}: {
  top: string;
  title?: string;
  notes?: (string | undefined)[];
  metrics: IMetric[];
  /** Off for changes nobody asked for (the overview's timed switch). */
  live?: 'polite' | 'off';
}) => {
  return (
    <div className={s.readout} aria-live={live}>
      <span className={s.top}>{top}</span>
      {title && <span className={s.title}>{title}</span>}
      {notes.filter(Boolean).map((note) => (
        <span key={note} className={s.note}>
          {note}
        </span>
      ))}
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

/** The search board's marks. */
export const SEARCH_LEGEND: [string, string, string?][] = [
  ['route', 'IN PROGRESS', 'hatch'],
  ['target', 'NEXT · TODO'],
  ['ink', 'DONE'],
  ['dim', 'BACKLOG'],
  ['caution', 'ON HOLD · OVERDUE', 'halo'],
  ['faint', 'CANCELLED · ARCHIVED'],
];

export const Legend = ({ entries = SEARCH_LEGEND }: { entries?: [string, string, string?][] }) => (
  <div className={s.legend} aria-label="Legend">
    {entries.map(([tone, label, mark]) => (
      <span key={`${tone}:${label}`}>
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

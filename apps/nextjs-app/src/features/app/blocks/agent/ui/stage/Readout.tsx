import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { forwardRef } from 'react';
import type { IMetric } from '../../model/metrics';
import type { ILegendEntry } from '../../model/overview/presentation';
import s from '../theme/cockpit.module.css';
import d from '../theme/deck.module.css';

/** Up to seven totals, one row each, label left and value right (the cockpit's kpis). */
export const Kpis = ({ metrics }: { metrics: IMetric[] }) => (
  <dl className={d.kpis} aria-label="Totals">
    {metrics.slice(0, 7).map((m) => (
      <div key={m.k} data-tone={m.tone}>
        <dt>{m.k}</dt>
        <dd>
          {typeof m.v === 'number' ? m.v.toLocaleString() : m.v}
          {m.s && <small>{m.s}</small>}
        </dd>
      </div>
    ))}
  </dl>
);

export interface IReadoutProps {
  /** The small line above the count, e.g. OVERVIEW · UPDATED 04:12Z. */
  top: string;
  count: number | string;
  unit: string;
  /** Caution lines: what the base lacks, the render budget, a stale read. */
  notes?: (string | undefined)[];
  /** The totals, when they sit in the corner (a boxed stage has them above it). */
  metrics?: IMetric[];
  /** The answer's lens is on: the readout counts what it cites. */
  lens?: boolean;
  /** Off for changes nobody asked for (the overview's timed switch). */
  live?: 'polite' | 'off';
}

/**
 * The stage's corner readout (the cockpit's): what is on the stage, its count and unit, notes,
 * and the totals, fixed in the corner while the chart turns. The ref measures it, so the chart
 * stays clear of it.
 */
export const Readout = forwardRef<HTMLDivElement, IReadoutProps>(
  ({ top, count, unit, notes = [], metrics, lens, live = 'polite' }, ref) => (
    <div ref={ref} className={d.readout} data-lens={lens ? 'true' : undefined}>
      <div className={d.head} aria-live={live}>
        <span className={d.coreTop}>{top}</span>
        <strong className={d.coreN}>
          {typeof count === 'number' ? count.toLocaleString() : count}
        </strong>
        <span className={d.coreUnit}>{unit}</span>
        {notes.filter(Boolean).map((note) => (
          <span key={note} className={d.coreNote}>
            {note}
          </span>
        ))}
      </div>
      {metrics && <Kpis metrics={metrics} />}
    </div>
  )
);
Readout.displayName = 'Readout';

/** The search board's marks. */
export const SEARCH_LEGEND: ILegendEntry[] = [
  ['route', 'IN PROGRESS', 'hatch'],
  ['target', 'NEXT · TODO', 'ring'],
  ['ink', 'DONE'],
  ['dim', 'BACKLOG'],
  ['caution', 'ON HOLD · OVERDUE', 'halo'],
  ['faint', 'CANCELLED · ARCHIVED'],
];

/** The marks used on the stage, two columns in its bottom-left corner. */
export const Legend = ({ entries = SEARCH_LEGEND }: { entries?: ILegendEntry[] }) => (
  <div className={d.legend} aria-label="Legend">
    {entries.map(([tone, label, mark]) => (
      <span key={`${tone}:${label}`}>
        <i className={d.sym} data-tone={tone} data-mark={mark} aria-hidden />
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

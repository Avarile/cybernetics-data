import { forwardRef } from 'react';
import type { IMetric } from '../../model/metrics';
import type { ILegendEntry } from '../../model/overview/presentation';
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
  /** Off for changes nobody asked for (the overview's timed switch). */
  live?: 'polite' | 'off';
}

/**
 * The stage's corner readout (the cockpit's): what is on the stage, its count and unit, notes,
 * and the totals, fixed in the corner while the chart turns. The ref measures it, so the chart
 * stays clear of it.
 */
export const Readout = forwardRef<HTMLDivElement, IReadoutProps>(
  ({ top, count, unit, notes = [], metrics, live = 'polite' }, ref) => (
    <div ref={ref} className={d.readout}>
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

/** The marks used on the stage, two columns in its bottom-left corner. */
export const Legend = ({ entries }: { entries: ILegendEntry[] }) => (
  <div className={d.legend} aria-label="Legend">
    {entries.map(([tone, label, mark]) => (
      <span key={`${tone}:${label}`}>
        <i className={d.sym} data-tone={tone} data-mark={mark} aria-hidden />
        {label}
      </span>
    ))}
  </div>
);

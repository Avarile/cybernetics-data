import type { ReactNode } from 'react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import type { IFrame } from '../../model/graph/layout';
import type { IMetric } from '../../model/metrics';
import type { ILegendEntry } from '../../model/overview/presentation';
import d from '../theme/deck.module.css';
import { Kpis, Legend, Readout, type IReadoutProps } from './Readout';
import { useStageFrame } from './stage-frame';

export interface IStageDeckProps {
  label: string;
  /** The HUD's title and the path under it (the cockpit's vizTitle and vizPath). */
  title: string;
  path?: string;
  readout?: Omit<IReadoutProps, 'metrics'>;
  metrics?: IMetric[];
  /** The chart (or what the stage says instead), given the free area to centre in. */
  chart?: (frame: IFrame | null) => ReactNode;
  /** Under the readout: the layout knobs, stacked (scope design §4.1). */
  layout?: ReactNode;
  /** Under the knobs: the lens chip, the pinned node. */
  aside?: ReactNode;
  legend?: ILegendEntry[];
  /** The stage's panels (vectors, flight log), under the ask panel in the rail. */
  panels?: ReactNode;
  /** The rail, which the cockpit keeps across stages so the conversation is never remounted. */
  rail: HTMLElement | null;
}

/**
 * The stage of the cockpit's deck (the ai-cockpit's layout): the chart full-bleed under
 * everything, the HUD in its free corners (title, readout, totals and the layout knobs
 * top-left, legend bottom-left), and the stage's panels in the rail floating on the right.
 * Stacked under 1180px: the totals above a boxed chart, the rail below it.
 */
export const StageDeck = (p: IStageDeckProps) => {
  const stageRef = useRef<HTMLElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const { frame, boxed } = useStageFrame(stageRef, readoutRef);
  return (
    <>
      <section ref={stageRef} className={d.stage} aria-label={p.label}>
        <div className={d.chart}>{p.chart?.(frame)}</div>
        <div className={d.hud}>
          <div className={`${d.ov} ${d.ovTl}`}>
            <b>{p.title}</b>
            {p.path && <span>{p.path}</span>}
            {/* measured as one block, so the chart keeps clear of the readout and the knobs */}
            <div ref={readoutRef} className={d.readoutBlock}>
              {p.readout && <Readout {...p.readout} metrics={boxed ? undefined : p.metrics} />}
              {p.layout}
            </div>
            {p.aside}
          </div>
          {p.legend && (
            <div className={`${d.ov} ${d.ovBl}`}>
              <Legend entries={p.legend} />
            </div>
          )}
        </div>
      </section>
      <div className={d.kpiSlot}>{boxed && p.metrics && <Kpis metrics={p.metrics} />}</div>
      {p.rail && p.panels && createPortal(p.panels, p.rail)}
    </>
  );
};

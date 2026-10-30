import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ILayoutMode, ITreeNode } from '../../model/graph/layout';
import type { IGraph } from '../../model/graph/types';
import c from '../theme/constellation.module.css';
import { ConstellationChart } from './constellation-chart';
import { createRotator } from './rotate';

export interface IConstellationProps {
  graph: IGraph;
  mode: ILayoutMode;
  /** Changes when the zoom should go back to the whole chart (the `0` key). */
  zoomResets?: number;
  /** Record ids the answer cites: the chart narrows to them, ancestors faint. */
  lens?: Set<string>;
  /** Record ids lit by the hover trace. */
  lit?: Set<string>;
  onHover: (recordId?: string) => void;
  onPin: (recordId: string) => void;
  /** A click on the empty chart. */
  onClear?: () => void;
  /** The pointer came onto the chart or left it (the overview holds its cycle meanwhile). */
  onPointerInside?: (inside: boolean) => void;
  /** Record labels (branches keep theirs); off on narrow screens. */
  labels?: boolean;
}

/** Records that arrive together beyond this many land without a pulse each. */
const PULSE_MAX = 24;

interface ITip {
  node: ITreeNode;
  x: number;
  y: number;
}

const tipKey = (n: ITreeNode) =>
  n.kind === 'root'
    ? ''
    : [n.short ?? n.table?.toUpperCase(), n.alert ? 'OVERDUE' : n.state]
        .filter(Boolean)
        .join(' · ');

/**
 * The search or the data base as a radial constellation (cockpit design §5.4), drawn by D3 as
 * the ai-cockpit draws it (ui/stage/constellation-chart.ts): records on the rim, the structure as
 * branches with their rims, links bundled through the tree, people as diamonds; it glides between
 * layouts and turns slowly unless motion is reduced. Drag to pan, wheel to zoom, double-click or
 * `0` to reset. React makes the chart once and hands it what changes; memoized, so a reply
 * streaming beside it does not touch it.
 */
export const Constellation = memo(
  ({
    graph,
    mode,
    zoomResets,
    lens,
    lit,
    onHover,
    onPin,
    onClear,
    onPointerInside,
    labels = true,
  }: IConstellationProps) => {
    const frameRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const chartRef = useRef<ConstellationChart>();
    const previous = useRef<IGraph>();
    const [tip, setTip] = useState<ITip>();
    // the chart is made once: it calls the latest handlers through this
    const handlers = useRef({ onHover, onPin, onClear, onPointerInside });
    handlers.current = { onHover, onPin, onClear, onPointerInside };
    const rotator = useMemo(
      () => createRotator((radians) => chartRef.current?.setRotation(radians), { fps: 30 }),
      []
    );

    useEffect(() => {
      const chart = new ConstellationChart(svgRef.current!, {
        onHover: (node, x, y) => {
          const shown = node && node.kind !== 'root' ? node : null;
          if (shown) rotator.hold();
          else rotator.release();
          handlers.current.onHover(shown?.id);
          const box = frameRef.current?.getBoundingClientRect();
          setTip(
            shown && box && x !== undefined && y !== undefined
              ? { node: shown, x: x - box.left, y: y - box.top }
              : undefined
          );
        },
        onPin: (id) => handlers.current.onPin(id),
        onClear: () => handlers.current.onClear?.(),
        onPointerInside: (inside) => {
          handlers.current.onPointerInside?.(inside);
          if (inside) return;
          rotator.release();
          setTip(undefined);
        },
      });
      chartRef.current = chart;
      return () => {
        chart.destroy();
        chartRef.current = undefined;
        previous.current = undefined;
      };
    }, [rotator]);

    useEffect(() => {
      chartRef.current?.setView({ mode, lens: lens?.size ? lens : null, labels });
    }, [mode, lens, labels]);

    // another search (or dataset) grows out of the core; the same one glides, its new records pulse
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;
      const before = previous.current;
      const fresh = !before || before.title !== graph.title;
      const changed = fresh
        ? undefined
        : new Set(graph.nodes.filter((n) => !before.byId.has(n.id)).map((n) => n.id));
      chart.setModel(graph, {
        fresh,
        changed: changed && changed.size <= PULSE_MAX ? changed : undefined,
      });
      previous.current = graph;
    }, [graph]);

    useEffect(() => {
      chartRef.current?.setView({ lit: lit?.size ? lit : null });
    }, [lit]);

    useEffect(() => {
      if (zoomResets) chartRef.current?.resetZoom();
    }, [zoomResets]);

    useEffect(() => {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      rotator.start();
      return () => rotator.stop();
    }, [rotator]);

    const width = frameRef.current?.clientWidth ?? 0;
    const flip = width > 0 && tip !== undefined && tip.x > width - 280;
    return (
      <div ref={frameRef} className={c.frame}>
        <svg ref={svgRef} className={c.chart} role="img" aria-label="Constellation" />
        {tip && (
          <div
            className={c.tip}
            data-tone={tip.node.tone}
            style={{
              top: tip.y + 14,
              ...(flip ? { right: width - tip.x + 14 } : { left: tip.x + 14 }),
            }}
          >
            {tipKey(tip.node) && <span className={c.tipKey}>{tipKey(tip.node)}</span>}
            <b>{tip.node.label}</b>
            {tip.node.kind !== 'root' &&
              tip.node.meta?.map(([k, v]) => (
                <span key={k}>
                  <i>{k}</i> {v}
                </span>
              ))}
          </div>
        )}
      </div>
    );
  }
);

Constellation.displayName = 'Constellation';

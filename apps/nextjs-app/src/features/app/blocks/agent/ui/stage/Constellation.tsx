import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  labelTransform,
  layoutGraph,
  nodeRadius,
  type ILaidNode,
  type ILayoutMode,
} from '../../model/graph/layout';
import type { IGraph } from '../../model/graph/types';
import s from '../theme/cockpit.module.css';
import { createRotator } from './rotate';

export interface IConstellationProps {
  graph: IGraph;
  mode: ILayoutMode;
  /** Record ids the answer cites: the chart narrows to them, ancestors faint. */
  lens?: Set<string>;
  /** Record ids lit by the hover trace. */
  lit?: Set<string>;
  onHover: (recordId?: string) => void;
  onPin: (recordId: string) => void;
}

/** Charts up to this many nodes plus links turn and flow; larger ones hold still. */
const MOTION_MAX = 400;

const truncate = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/**
 * The search as a radial constellation (cockpit design §5.4): records on the rim, the plan's
 * structure as branches, links bundled through the tree, people as diamonds. Drag to pan, wheel
 * to zoom, double-click to reset; it turns slowly unless motion is reduced.
 */
export const Constellation = ({ graph, mode, lens, lit, onHover, onPin }: IConstellationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rotation, setRotation] = useState(0);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const rotator = useMemo(() => createRotator(setRotation), []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    observer.observe(el);
    const behaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 6])
      .on('zoom', (e: { transform: ZoomTransform }) => setTransform(e.transform));
    select(el)
      .call(behaviour)
      .on('dblclick.zoom', () => select(el).call(behaviour.transform, zoomIdentity));
    return () => {
      observer.disconnect();
      select(el).on('.zoom', null);
    };
  }, []);

  // motion costs in proportion to what is drawn: large charts hold still (as the cockpit's do)
  const still = graph.nodes.length + graph.links.length > MOTION_MAX;
  useEffect(() => {
    if (still || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    rotator.start();
    return () => rotator.stop();
  }, [rotator, still]);

  const radius = Math.max(80, Math.min(size.w, size.h) / 2 - 16);
  const layout = useMemo(
    () => layoutGraph(graph, { mode, radius, lens: lens?.size ? lens : null, rotation }),
    [graph, mode, radius, lens, rotation]
  );
  const dim = (id?: string) => Boolean(lit?.size && id && !lit.has(id));
  const showLabel = (n: ILaidNode) =>
    n.node && (n.leaf || n.node.kind === 'hub') && layout.nodes.length < 260;

  return (
    <svg
      ref={svgRef}
      className={s.constellation}
      data-still={still ? 'true' : undefined}
      role="img"
      aria-label="Search constellation"
    >
      <g
        transform={`translate(${size.w / 2 + transform.x},${size.h / 2 + transform.y}) scale(${transform.k})`}
      >
        {layout.branches.map((b) => (
          <path key={b.id} d={b.d} className={s.branch} />
        ))}
        {layout.edges.map((e) => (
          <path
            key={e.id}
            d={e.d}
            className={s.edge}
            data-tone={e.link.tone}
            data-dim={dim(e.link.source) && dim(e.link.target) ? 'true' : undefined}
          >
            <title>{e.link.label}</title>
          </path>
        ))}
        {layout.nodes.map((n) => {
          if (!n.node) return <circle key={n.id} r={4} className={s.core} />;
          const node = n.node;
          const label = labelTransform(n, node.kind === 'hub' ? 8 : 6);
          return (
            <g
              key={n.id}
              className={s.node}
              data-tone={node.tone}
              data-kind={node.kind}
              data-context={n.context ? 'true' : undefined}
              data-dim={dim(node.id) ? 'true' : undefined}
              onMouseEnter={() => {
                rotator.hold();
                onHover(node.id);
              }}
              onMouseLeave={() => {
                rotator.release();
                onHover(undefined);
              }}
              onClick={() => onPin(node.id)}
            >
              <g transform={`translate(${n.x},${n.y})`}>
                {node.alert && <circle r={nodeRadius(node) + 3.5} className={s.halo} />}
                {node.kind === 'actor' ? (
                  <rect x={-4} y={-4} width={8} height={8} transform="rotate(45)" />
                ) : (
                  <circle
                    r={node.kind === 'hub' ? 4 : nodeRadius(node)}
                    data-ring={node.tone === 'target' ? 'true' : undefined}
                  />
                )}
              </g>
              {showLabel(n) && (
                <text transform={label.transform} textAnchor={label.anchor} dy="0.32em">
                  {truncate(node.label, node.kind === 'hub' ? 28 : 22)}
                </text>
              )}
              <title>
                {[
                  node.short,
                  node.label,
                  node.state,
                  ...(node.meta ?? []).map(([k, v]) => `${k}: ${v}`),
                ]
                  .filter(Boolean)
                  .join('\n')}
              </title>
            </g>
          );
        })}
      </g>
    </svg>
  );
};

import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
  /** Changes when the zoom should go back to the whole chart (the `0` key). */
  zoomResets?: number;
  /** Record ids the answer cites: the chart narrows to them, ancestors faint. */
  lens?: Set<string>;
  /** Record ids lit by the hover trace. */
  lit?: Set<string>;
  onHover: (recordId?: string) => void;
  onPin: (recordId: string) => void;
}

/** Charts up to this many nodes plus links turn and flow; larger ones hold still. */
const MOTION_MAX = 400;
/** Past this many nodes the records lose their labels; branches keep theirs. */
const LABELS_MAX = 260;

const truncate = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/**
 * The search as a radial constellation (cockpit design §5.4): records on the rim, the plan's
 * structure as branches, links bundled through the tree, people as diamonds. Drag to pan, wheel
 * to zoom, double-click or `0` to reset; it turns slowly unless motion is reduced. Memoized, so a
 * reply streaming beside it does not redraw it.
 */
export const Constellation = memo(
  ({ graph, mode, zoomResets, lens, lit, onHover, onPin }: IConstellationProps) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>();
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
      zoomRef.current = behaviour;
      select(el)
        .call(behaviour)
        .on('dblclick.zoom', () => select(el).call(behaviour.transform, zoomIdentity));
      return () => {
        observer.disconnect();
        select(el).on('.zoom', null);
      };
    }, []);

    useEffect(() => {
      if (zoomResets && svgRef.current && zoomRef.current)
        select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
    }, [zoomResets]);

    // motion costs in proportion to what is drawn: large charts hold still (as the cockpit's do)
    const still = graph.nodes.length + graph.links.length > MOTION_MAX;
    useEffect(() => {
      if (still || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      rotator.start();
      return () => rotator.stop();
    }, [rotator, still]);

    const measured = size.w > 0 && size.h > 0;
    const radius = Math.max(80, Math.min(size.w, size.h) / 2 - 16);
    const layout = useMemo(
      () => layoutGraph(graph, { mode, radius, lens: lens?.size ? lens : null, rotation }),
      [graph, mode, radius, lens, rotation]
    );
    const dim = (id?: string) => Boolean(lit?.size && id && !lit.has(id));
    const showLabel = (n: ILaidNode) =>
      n.node && (n.node.kind === 'hub' || (n.leaf && layout.nodes.length < LABELS_MAX));

    return (
      <svg
        ref={svgRef}
        className={s.constellation}
        data-still={still ? 'true' : undefined}
        role="img"
        aria-label="Search constellation"
        // a node that vanished under the pointer never says it was left: the chart does
        onMouseLeave={() => {
          rotator.release();
          onHover(undefined);
        }}
      >
        {/* zoom outside, centring inside: d3-zoom pivots at the pointer only when its transform
            is the outermost one (the cockpit's tree.ts nests them the same way) */}
        {measured && (
          <g transform={transform.toString()}>
            <g transform={`translate(${size.w / 2},${size.h / 2})`}>
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
                    data-key={node.cardKey}
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
          </g>
        )}
      </svg>
    );
  }
);

Constellation.displayName = 'Constellation';

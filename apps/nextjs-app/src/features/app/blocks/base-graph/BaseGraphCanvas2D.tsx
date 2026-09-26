import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-2d';
import ForceGraph2D from 'react-force-graph-2d';
import type { IBaseGraphCanvasHandle } from './BaseGraphCanvas';
import type {
  ISimulationGraph,
  ISimulationLink,
  ISimulationNode,
} from './utils/buildSimulationGraph';
import { isLinkVisible, isNodeVisible } from './utils/buildSimulationGraph';
import {
  chargeFor,
  CHARGE_DISTANCE_MAX,
  colorForNode,
  linkDistanceFor,
  linkStrengthFor,
  nodeValFor,
} from './utils/graphTheme';

/**
 * The 2D renderer for graphs too large for WebGL spheres and sprites: a single
 * canvas, no per-node GPU objects. Same forces and colours as the 3D view minus
 * the sphere pin, which has no meaning on a plane, and minus auto-rotate.
 */

const FOCUS_TRANSITION_MS = 700;
const FOCUS_ZOOM = 4;
/** Hub labels always; record labels only once zoomed in enough to read them. */
const RECORD_LABEL_MIN_SCALE = 2.5;
const LINK_COLOR = 'rgba(71, 85, 105, 0.3)';

interface IBaseGraphCanvas2DProps {
  graph: ISimulationGraph;
  width: number;
  height: number;
  backgroundColor: string;
  focusedNodeId: string | null;
  onNodeClick: (nodeId: string | null) => void;
  onUserInteract: () => void;
}

type INode = NodeObject<ISimulationNode>;

export const BaseGraphCanvas2D = forwardRef<IBaseGraphCanvasHandle, IBaseGraphCanvas2DProps>(
  (props, ref) => {
    const { graph, width, height, backgroundColor, focusedNodeId, onNodeClick, onUserInteract } =
      props;
    const fgRef = useRef<ForceGraphMethods<INode, ISimulationLink> | undefined>(undefined);

    useImperativeHandle(
      ref,
      () => ({ recenterOnCore: () => fgRef.current?.zoomToFit(FOCUS_TRANSITION_MS, 40) }),
      []
    );

    // Tier lookups are total (see graphTheme.ts): an undefined force value
    // would make d3 compute NaN positions and draw nothing at all.
    useEffect(() => {
      const fg = fgRef.current;
      if (!fg) return;
      const linkForce = fg.d3Force('link');
      linkForce?.distance?.((link: { tier?: string }) => linkDistanceFor(link.tier ?? ''));
      linkForce?.strength?.((link: { tier?: string }) => linkStrengthFor(link.tier ?? ''));
      const charge = fg.d3Force('charge');
      charge?.strength?.((node: ISimulationNode) => chargeFor(node.tier));
      charge?.distanceMax?.(CHARGE_DISTANCE_MAX);
    }, [graph]);

    useEffect(() => {
      if (!focusedNodeId) return;
      const node = graph.nodes.find((n) => n.id === focusedNodeId);
      if (!node || node.x === undefined || node.y === undefined) return;
      fgRef.current?.centerAt(node.x, node.y, FOCUS_TRANSITION_MS);
      fgRef.current?.zoom(FOCUS_ZOOM, FOCUS_TRANSITION_MS);
    }, [focusedNodeId, graph]);

    const drawLabel = useCallback(
      (node: INode, ctx: CanvasRenderingContext2D, scale: number) => {
        const isHub = node.tier !== 'knowledge';
        if (!isHub && scale < RECORD_LABEL_MIN_SCALE && node.id !== focusedNodeId) return;
        const size = (isHub ? 12 : 10) / scale;
        ctx.font = `${isHub ? 600 : 400} ${size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = colorForNode(node);
        const radius = Math.cbrt(nodeValFor(node.tier, node.degree)) * 4;
        ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + radius + 1 / scale);
      },
      [focusedNodeId]
    );

    const nodeLabel = useMemo(() => (node: INode) => node.label, []);

    return (
      <ForceGraph2D<INode, ISimulationLink>
        ref={fgRef}
        graphData={graph as { nodes: INode[]; links: ISimulationLink[] }}
        width={width}
        height={height}
        backgroundColor={backgroundColor}
        nodeId="id"
        nodeLabel={nodeLabel}
        nodeVal={(node) => nodeValFor(node.tier, node.degree)}
        nodeColor={(node) => colorForNode(node)}
        nodeVisibility={isNodeVisible}
        linkVisibility={isLinkVisible}
        linkColor={() => LINK_COLOR}
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={drawLabel}
        enableNodeDrag={false}
        onNodeClick={(node) => onNodeClick(node.id ?? null)}
        onBackgroundClick={() => onNodeClick(null)}
        onZoom={onUserInteract}
        cooldownTicks={220}
        d3AlphaDecay={0.015}
      />
    );
  }
);

BaseGraphCanvas2D.displayName = 'BaseGraphCanvas2D';

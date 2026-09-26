import { forceRadial } from 'd3-force-3d';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { ForceGraphMethods } from 'react-force-graph-3d';
import ForceGraph3D from 'react-force-graph-3d';
import type { Camera } from 'three';
import SpriteText from 'three-spritetext';
import type {
  ISimulationGraph,
  ISimulationLink,
  ISimulationNode,
} from './utils/buildSimulationGraph';
import { isLinkVisible, isNodeVisible, linkEndpointId } from './utils/buildSimulationGraph';
import {
  chargeFor,
  CHARGE_DISTANCE_MAX,
  colorForNode,
  focusDistanceFor,
  linkDistanceFor,
  linkStrengthFor,
  nodeValFor,
  radialStrengthFor,
  SPHERE_RADIUS,
  standoffPosition,
} from './utils/graphTheme';

/**
 * Time-based, not per-frame. A fixed radians-per-frame step is tied to the
 * display: the previous 0.0016 rad/frame ran at 5.5°/s on a 60Hz panel but
 * 11°/s on a 120Hz one. Expressed per second, the speed is what it says.
 *
 * 2.5°/s is roughly one revolution every 2.5 minutes — a drift you notice
 * without it pulling your eye.
 */
const ROTATE_DEG_PER_SEC = 2.5;
const ROTATE_RAD_PER_MS = (ROTATE_DEG_PER_SEC * Math.PI) / 180 / 1000;

/**
 * Caps the step when frames are far apart, so coming back to a backgrounded tab
 * resumes the drift instead of snapping the camera through a large angle.
 */
const MAX_FRAME_MS = 100;

const LABEL_HEIGHT = 6;
const FOCUS_TRANSITION_MS = 900;

/**
 * Link paint, kept as two constants with one owner for transparency.
 * three-forcegraph multiplies the two channels — `linkOpacity * colorAlpha(color)`
 * — so the previous `rgba(148, 163, 184, 0.35)` alongside `linkOpacity={0.35}`
 * resolved to 0.1225, measuring 1.09:1 against CANVAS_BACKGROUND: in the scene
 * graph, invisible on screen. The colour is therefore opaque and LINK_OPACITY
 * alone owns the alpha.
 *
 * slate-600 at 0.7 measures 3.34:1. That clears the 3:1 floor for non-text
 * graphics and lands on the leaf nodes' own 3.37:1, so a branch is traceable
 * without the edges out-shouting what they connect. The old slate-400 could not
 * reach 3:1 at any alpha (1.73:1 even fully applied) — its lightness was the
 * ceiling, not the double multiply.
 *
 * Weight is left alone: `linkWidth` stays unset, because any truthy value swaps
 * every link for a CylinderGeometry mesh — one per link, ~2000 at the node
 * budget — and a cylinder thins with distance, where an unset width renders a
 * dimensionless line that holds 1px at every zoom level.
 */
const LINK_COLOR = '#475569';
const LINK_OPACITY = 0.14;

interface ITrackballControls {
  target: { x: number; y: number; z: number };
  update: () => void;
}

export interface IBaseGraphCanvasHandle {
  /**
   * Ease the camera back onto the base hub — every branch hangs from it, so it
   * is the scene's centre (the origin when there is no hub). Imperative rather than a piece of view state: it
   * is a one-shot command, and modelling it as state would need a nonce to make
   * a second press do anything at all.
   */
  recenterOnCore: () => void;
}

interface IBaseGraphCanvasProps {
  graph: ISimulationGraph;
  width: number;
  height: number;
  backgroundColor: string;
  focusedNodeId: string | null;
  autoRotate: boolean;
  onNodeClick: (nodeId: string | null) => void;
  /** Called when the user grabs the scene, so auto-rotate can yield. */
  onUserInteract: () => void;
}

const LABELLED_TIERS = new Set(['core', 'type']);

/**
 * Also label the best-connected records, so a flat multi-table view has some
 * landmarks. Bounded: every label is a canvas texture and a draw call.
 */
const TOP_DEGREE_LABELS = 150;

/**
 * Labels sit closer to a knowledge than to a type, and closer again than to the
 * core, because the node they annotate is that much smaller — a leaf renders at
 * roughly 1.34 world units against a type's ~2.3 and the core's (undrawn) 8.
 */
const LABEL_OFFSET: Record<string, number> = { core: 24, type: 10, knowledge: 5 };
const DEFAULT_LABEL_OFFSET = 10;

const disposeSprites = (map: Map<string, SpriteText>) => {
  map.forEach((sprite) => {
    sprite.material.map?.dispose();
    sprite.material.dispose();
  });
  map.clear();
};

export const BaseGraphCanvas = forwardRef<IBaseGraphCanvasHandle, IBaseGraphCanvasProps>(
  (props, ref) => {
    const {
      graph,
      width,
      height,
      backgroundColor,
      focusedNodeId,
      autoRotate,
      onNodeClick,
      onUserInteract,
    } = props;

    const fgRef = useRef<ForceGraphMethods<ISimulationNode, ISimulationLink> | undefined>(
      undefined
    );
    const spriteMapRef = useRef(new Map<string, SpriteText>());

    /**
     * Knowledge nodes that other knowledges nest under.
     *
     * Derived from the links rather than read off the node: `degree` also counts
     * peer relations, so it cannot answer "does this have children" on its own,
     * and a dedicated payload field would be paid for on all 2000 nodes to
     * describe the few that have any. This also gives `linkEndpointId` its first
     * production caller — the endpoints are strings on a freshly built graph but
     * node objects once the simulation has ticked, and this memo can be read in
     * either state.
     */
    const parentKnowledgeIds = useMemo(
      () =>
        new Set(
          graph.links
            .filter((link) => link.tier === 'knowledge-parent')
            .map((link) => linkEndpointId(link.source))
        ),
      [graph]
    );

    /**
     * Always-on labels for `core`, `type`, and any knowledge with children. Each
     * SpriteText allocates a canvas-backed texture plus a material and adds a
     * draw call, so labelling every node at the 2000-node budget would mean 2000
     * textures and 2000 extra draw calls. Core + types is bounded at roughly
     * 1 + 50; parent knowledges add only the interior nodes of the nesting tree,
     * which is bounded by how much nesting actually exists — and an unlabelled
     * parent is exactly the node whose label carries the most meaning, since it
     * names a group rather than a leaf.
     *
     * Gated on visibility so a hidden tier never allocates a texture it cannot
     * show, and so the two policies cannot drift apart.
     */
    const topDegreeIds = useMemo(
      () =>
        new Set(
          graph.nodes
            .filter((node) => node.tier === 'knowledge' && node.degree > 1)
            .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
            .slice(0, TOP_DEGREE_LABELS)
            .map((node) => node.id)
        ),
      [graph]
    );

    const shouldLabel = useCallback(
      (node: ISimulationNode) =>
        isNodeVisible(node) &&
        (LABELLED_TIERS.has(node.tier) ||
          parentKnowledgeIds.has(node.id) ||
          topDegreeIds.has(node.id)),
      [parentKnowledgeIds, topDegreeIds]
    );

    // The core is in the simulation but never drawn, so its coordinates are the
    // only handle on where the scene's centre actually drifted to. Falling back to
    // the origin is right rather than defensive: that is where the hub of the star
    // sits, and where an empty scene is centred.
    useImperativeHandle(
      ref,
      () => ({
        recenterOnCore: () => {
          const fg = fgRef.current;
          if (!fg) {
            return;
          }
          const core = graph.nodes.find((node) => node.tier === 'core');
          const target = { x: core?.x ?? 0, y: core?.y ?? 0, z: core?.z ?? 0 };
          const camera = fg.camera() as Camera;
          fg.cameraPosition(
            standoffPosition(camera.position, target, focusDistanceFor('core')),
            target,
            FOCUS_TRANSITION_MS
          );
        },
      }),
      [graph]
    );

    // Tier-keyed force lookups are total via the `*For` helpers: an unknown tier
    // returning undefined makes d3 compute NaN positions, and the scene renders
    // empty with no error at all.
    //
    // `distanceMax` is what keeps the layout from resolving into a star: an
    // uncapped many-body force has every node repelling every other at any
    // separation, and those long-range terms sum to a push away from the centre of
    // mass. See CHARGE_DISTANCE_MAX for the whole argument. It is set here rather
    // than at construction because three-forcegraph registers the force itself;
    // this effect is the only hook we have on it.
    useEffect(() => {
      const fg = fgRef.current;
      if (!fg) {
        return;
      }
      const linkForce = fg.d3Force('link');
      linkForce?.distance?.((link: { tier?: string }) => linkDistanceFor(link.tier ?? ''));
      linkForce?.strength?.((link: { tier?: string }) => linkStrengthFor(link.tier ?? ''));
      const charge = fg.d3Force('charge');
      charge?.strength?.((node: ISimulationNode) => chargeFor(node.tier));
      charge?.distanceMax?.(CHARGE_DISTANCE_MAX);
      // Pins type and knowledge nodes onto one sphere shell — see SPHERE_RADIUS
      // for why the core is excluded and both other tiers share a radius.
      fg.d3Force(
        'radial',
        forceRadial<ISimulationNode>(SPHERE_RADIUS, 0, 0, 0).strength((node) =>
          radialStrengthFor(node.tier)
        )
      );
    }, [graph]);

    // Sprites are cached by node id and reused across filter changes, so a legend
    // toggle does not churn the whole label set. Disposal runs on graph change as
    // well as unmount: clearing the map without disposing leaks one GPU texture
    // per sprite per rebuild.
    useEffect(() => {
      const map = spriteMapRef.current;
      const live = new Set(graph.nodes.filter(shouldLabel).map((node) => node.id));
      map.forEach((sprite, id) => {
        if (!live.has(id)) {
          sprite.material.map?.dispose();
          sprite.material.dispose();
          map.delete(id);
        }
      });
    }, [graph, shouldLabel]);

    const nodeThreeObject = useCallback(
      (node: ISimulationNode) => {
        const map = spriteMapRef.current;
        if (!shouldLabel(node)) {
          // With nodeThreeObjectExtend, a falsy return leaves the node as the
          // default sphere and adds nothing — no texture, no extra draw call.
          return undefined as unknown as SpriteText;
        }
        const cached = map.get(node.id);
        if (cached) {
          return cached;
        }
        const sprite = new SpriteText(node.label, LABEL_HEIGHT, colorForNode(node));
        sprite.fontWeight = '600';
        sprite.position.set(0, LABEL_OFFSET[node.tier] ?? DEFAULT_LABEL_OFFSET, 0);
        map.set(node.id, sprite);
        return sprite;
      },
      [shouldLabel]
    );

    // Orbit about the world Y axis through the controls target, and let the
    // controls own lookAt and the up vector. Writing camera.position AND calling
    // camera.lookAt every frame fights TrackballControls, which writes the same
    // properties from its own target, and the up-vector drifts.
    useEffect(() => {
      if (!autoRotate) {
        return;
      }
      let raf = 0;
      let previous = 0;
      const tick = (now: number) => {
        const fg = fgRef.current;
        const controls = fg?.controls() as ITrackballControls | undefined;
        // The first frame has no predecessor, so it only establishes the baseline.
        const elapsed = previous ? Math.min(now - previous, MAX_FRAME_MS) : 0;
        previous = now;

        if (fg && controls && elapsed > 0) {
          const angle = elapsed * ROTATE_RAD_PER_MS;
          const cam = fg.camera() as Camera;
          const { x: tx, z: tz } = controls.target;
          const dx = cam.position.x - tx;
          const dz = cam.position.z - tz;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          cam.position.x = tx + dx * cos + dz * sin;
          cam.position.z = tz + dz * cos - dx * sin;
          // y is the orbit axis and is left untouched.
          controls.update();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [autoRotate]);

    // Listeners go on the renderer's own canvas: that is the element which
    // actually receives the gestures, and it survives the fullscreen re-parent.
    useEffect(() => {
      const el = fgRef.current?.renderer().domElement;
      if (!el) {
        return;
      }
      const stop = () => onUserInteract();
      el.addEventListener('pointerdown', stop, { passive: true });
      el.addEventListener('wheel', stop, { passive: true });
      return () => {
        el.removeEventListener('pointerdown', stop);
        el.removeEventListener('wheel', stop);
      };
    }, [onUserInteract]);

    // Ease the camera along the vector from the scene centre to the node, holding
    // a tier-dependent standoff. cameraPosition animates and drives the controls
    // target itself, so it composes with auto-rotate rather than fighting it.
    useEffect(() => {
      if (!focusedNodeId) {
        return;
      }
      const node = graph.nodes.find((candidate) => candidate.id === focusedNodeId);
      if (!node) {
        return;
      }
      const distance = focusDistanceFor(node.tier);
      const { x = 0, y = 0, z = 0 } = node;
      const ratio = 1 + distance / Math.hypot(x, y, z || 1);
      fgRef.current?.cameraPosition(
        { x: x * ratio, y: y * ratio, z: z * ratio },
        { x, y, z },
        FOCUS_TRANSITION_MS
      );
    }, [focusedNodeId, graph]);

    // Teardown is required, and doubly so because reactStrictMode runs effects
    // twice in dev — a missing teardown leaks a second WebGL context immediately.
    useEffect(() => {
      const spriteMap = spriteMapRef.current;
      return () => {
        // fgRef.current is read here on purpose rather than captured above: we
        // need the instance that exists at unmount, not one snapshotted earlier.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const fg = fgRef.current as (typeof fgRef)['current'] & { _destructor?: () => void };
        fg?.pauseAnimation();
        disposeSprites(spriteMap);
        fg?._destructor?.();
      };
    }, []);

    useEffect(() => {
      const onVisibilityChange = () => {
        const fg = fgRef.current;
        if (!fg) {
          // Already torn down.
          return;
        }
        if (document.hidden) {
          fg.pauseAnimation();
        } else {
          fg.resumeAnimation();
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    const handleNodeClick = useCallback(
      (node: ISimulationNode) => onNodeClick(node.id ?? null),
      [onNodeClick]
    );

    const nodeLabel = useMemo(() => (node: ISimulationNode) => node.label, []);

    return (
      <ForceGraph3D<ISimulationNode, ISimulationLink>
        ref={fgRef}
        graphData={graph}
        width={width}
        height={height}
        backgroundColor={backgroundColor}
        nodeId="id"
        nodeLabel={nodeLabel}
        nodeVal={(node) => nodeValFor(node.tier, node.degree)}
        nodeColor={(node) => colorForNode(node)}
        nodeOpacity={0.9}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend
        nodeVisibility={isNodeVisible}
        linkVisibility={isLinkVisible}
        linkColor={() => LINK_COLOR}
        linkOpacity={LINK_OPACITY}
        enableNodeDrag={false}
        onNodeClick={handleNodeClick}
        onBackgroundClick={() => onNodeClick(null)}
        // The tether holding the branches together is near-slack by design, so the
        // layout settles more slowly than a stiff star would. 220 is where the
        // clusters stop visibly moving; the cap is what bounds the CPU cost.
        cooldownTicks={220}
        d3AlphaDecay={0.015}
      />
    );
  }
);

BaseGraphCanvas.displayName = 'BaseGraphCanvas';

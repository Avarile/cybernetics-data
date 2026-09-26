import { GROUP_NONE_SUFFIX } from '@teable/openapi';
import type { ISimulationNode } from './buildSimulationGraph';
import type {
  VisualLinkTier as KnowledgeLinkTier,
  VisualNodeTier as KnowledgeNodeTier,
} from './visualTier';

/*
 * Ported from the knowledge graph with its tuning intact. The lookups stay keyed
 * by the visual tier (see visualTier.ts), which is why the names below still
 * speak of types and knowledges: that is the role a node plays in the layout.
 */

/**
 * FNV-1a. Stable and data-independent: a type keeps its hue when siblings are
 * added or removed, which an index-based palette could never guarantee.
 */
const hashHue = (id: string): number => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
};

export const CORE_COLOR = '#e8e3d9';
export const UNCLASSIFIED_COLOR = '#6b7280';

/**
 * Hue comes from the ROOT ancestor, so a whole subtree reads as one family;
 * lightness comes from depth, so nesting is legible within that family.
 *
 * Lightness decays asymptotically towards its floor rather than clamping onto
 * it, so it strictly decreases at every depth instead of flattening once the
 * floor is reached — a hard `Math.max` clamp let a type at depth 3+ and its
 * own deeper descendants render as the identical colour. The decay also keeps
 * a type lighter than its own knowledges at every depth, provably rather than
 * by inspection: for a type at depth d and its child knowledge at depth d+1,
 *   type(d)        = 40 + 22 * 0.75^d
 *   knowledge(d+1) = 28 + 18 * 0.75^d
 *   difference     = 12 + 4 * 0.75^d  >  0  for every d
 */
export const colorForNode = (
  node: Pick<ISimulationNode, 'tier' | 'colorKey' | 'depth'>
): string => {
  if (node.tier === 'core') {
    return CORE_COLOR;
  }
  const key = node.colorKey;
  if (!key || key.endsWith(`:${GROUP_NONE_SUFFIX}`)) {
    return UNCLASSIFIED_COLOR;
  }
  const hue = hashHue(key);
  if (node.tier === 'type') {
    return `hsl(${hue} 72% ${(40 + 22 * Math.pow(0.75, node.depth)).toFixed(1)}%)`;
  }
  return `hsl(${hue} 52% ${(28 + 18 * Math.pow(0.75, Math.max(0, node.depth - 1))).toFixed(1)}%)`;
};

/**
 * Leaf size, and the knob most likely to be retuned by eye. It is a volume, not
 * a radius: at the default `nodeRelSize` of 4 (never overridden here) a leaf
 * renders at `cbrt(0.0375) * 4` ≈ 1.34 world units, against a `type-knowledge`
 * link length of 32. Halving the on-screen radius means dividing this by 8,
 * since `cbrt(1/8) = 1/2` — which is exactly how it reached 0.0375 from the 0.3
 * the layout was first tuned at.
 */
export const KNOWLEDGE_NODE_VAL = 0.0375;

/**
 * `nodeVal` is volumetric: three-forcegraph renders a sphere of
 * `cbrt(nodeVal) * nodeRelSize`. Scaling the value by 0.2 therefore shrinks the
 * visible radius by `cbrt(0.2)` ≈ 0.585, i.e. about 41% smaller on screen.
 *
 * Core and type no longer share one scale. Types were halved on screen next to
 * the leaves — 0.2 → 0.025, one eighth, per the cube root above — while the
 * core kept the original value because it is never drawn at all: `isNodeVisible`
 * filters it out of the render digest, so its size is a design reference for the
 * hierarchy assertion in buildSimulationGraph.spec.ts rather than pixels on
 * screen. Shrinking it would only move that reference.
 */
const CORE_VAL_SCALE = 0.2;
const TYPE_VAL_SCALE = 0.025;

/**
 * A type node must never render smaller than the knowledge nodes hanging off it
 * — that reads as an inverted hierarchy. The degree formula below carries that
 * on its own at the current leaf size: its minimum, at degree 0, is
 * `8 * 0.025 = 0.2`, over five times the leaf value and so ~75% wider on screen.
 * Real taxonomies here carry only a handful of children each, so most types sit
 * near that minimum; the cap at degree 40 keeps the largest (0.8) under the
 * core (8).
 *
 * Those two proportions survived the halving unchanged, and not by luck: both
 * rendered tiers were divided by the same 8, and the invariant compares a ratio,
 * where a common factor cancels exactly. Halving only one of them is what would
 * break it — the reason the two scales are separate constants rather than one
 * knob to nudge.
 *
 * A `Math.max(KNOWLEDGE_NODE_VAL * 2, …)` floor used to guard this, and it did
 * bind while the leaf value was 2 — it goes dormant below a leaf of 0.1, so at
 * 0.0375 it can never fire. It is removed rather than left dormant because a
 * clamp that silently rescues an inverted hierarchy hides the retuning that
 * caused it. The invariant is asserted across every degree in
 * buildSimulationGraph.spec.ts instead: set KNOWLEDGE_NODE_VAL to 0.2 or beyond
 * and that spec fails, which is the signal you want.
 */
export const NODE_VAL: Record<KnowledgeNodeTier, (degree: number) => number> = {
  core: () => 40 * CORE_VAL_SCALE,
  type: (degree) => (8 + Math.min(degree, 40) * 0.6) * TYPE_VAL_SCALE,
  // Degree-aware since v3, so a knowledge that others nest under reads as a
  // hub rather than as one more leaf. Anchored at degree 1 — a leaf carries
  // exactly one structural edge, no children and no relations — so every node
  // that existed before nesting keeps its exact previous size.
  //
  // The cap is what preserves the tier invariant above: the maximum here is
  // KNOWLEDGE_NODE_VAL * 4 = 0.15, still under a childless type's 0.2, so a
  // well-connected knowledge can never out-size the type holding it. Raising
  // either the 12 or the 0.25 means re-checking that pair.
  knowledge: (degree) => KNOWLEDGE_NODE_VAL * (1 + Math.min(Math.max(degree - 1, 0), 12) * 0.25),
};
export const DEFAULT_NODE_VAL = KNOWLEDGE_NODE_VAL;

/**
 * Note that `type-knowledge` sets the rest length of the spring, not the radius
 * you see. Leaves carry their own charge, so they push each other off that
 * sphere until repulsion balances the link: at a rest length of 32 the clusters
 * measure ~53, held there by TIER_CHARGE.knowledge. Halving this shrinks a
 * cluster by roughly a third, not by half; that charge is the knob for the rest.
 */
export const LINK_DISTANCE: Record<KnowledgeLinkTier, number> = {
  'core-type': 260,
  // Short enough that a child type sits near its parent rather than out at the
  // core-type radius, so nesting reads as proximity.
  'type-parent': 90,
  'type-knowledge': 32,
  // Shorter than type-knowledge, so a nested knowledge sits INSIDE its parent's
  // lobe rather than beside it as another leaf of the type — that difference is
  // the only thing distinguishing the two relationships on screen, since links
  // are painted one flat colour.
  //
  // Coupled to CHARGE_DISTANCE_MAX like type-knowledge, but in the opposite
  // direction to what a chain length of 32 + 24 suggests. Replaying the layout
  // headlessly (the harness in the organic-clusters doc, extended to nest a
  // fraction of leaves onto sibling leaves) measures the mean cluster radius
  // FALLING as nesting rises — 52→44 at the 1000-node budget going from no
  // nesting to 60% — because a nested leaf sits 24 from its parent rather than
  // 32 from the type. Outward bias stays within |0.005|-|0.071| and the closest
  // type pair holds 1.5-3.5x the cluster radius at every point in that sweep.
  // So this buys headroom under the 110 cap rather than spending it; raising it
  // past type-knowledge's 32 is what would need the pair re-checked.
  'knowledge-parent': 24,
  // Long relative to a cluster's own radius (~53), so a relation reaches across
  // the gap between two clusters instead of trying to plant one inside the
  // other's radius, which is what pulls them into a single blob. 180 rather
  // than a shorter rest length: swept against nested types (see
  // LINK_STRENGTH['knowledge-knowledge']), a shorter distance measured a
  // tighter min-type-gap/cluster-radius ratio without buying back any outward
  // bias, i.e. it only cost separation.
  'knowledge-knowledge': 180,
};
export const DEFAULT_LINK_DISTANCE = 120;

/**
 * Link stiffness, and half of what stops the layout collapsing into a star.
 *
 * `core-type` is deliberately near-slack: it is a tether that keeps the branches
 * from drifting apart, not a placement force. At the default strength every type
 * is dragged onto one sphere of radius LINK_DISTANCE['core-type'], which is a
 * shell — and a shell viewed from inside reads as spokes radiating from the
 * middle. Note that it is the strength that does this, not the distance: at
 * 0.005 the tether only asserts itself once a type has wandered far, so type
 * placement is decided by type↔type repulsion instead, which fills a volume,
 * and LINK_DISTANCE['core-type'] is free to stay where it always was.
 *
 * `type-knowledge` goes the other way. Stiff, so a type and its leaves move as
 * one object, which is what makes a cluster read as a cluster rather than as a
 * hub with trailing threads.
 */
export const LINK_STRENGTH: Record<KnowledgeLinkTier, number> = {
  'core-type': 0.005,
  // Holds a subtree together, looser than a type holds its own leaves, so
  // nesting reads as nesting rather than as one merged cluster.
  'type-parent': 0.35,
  'type-knowledge': 0.7,
  // Stiffer than type-knowledge, not looser: this is the tightest binding in
  // the graph, because a nested knowledge and its parent are one object in a
  // way a type and its leaves are not. Deliberately the opposite ordering from
  // type-parent vs type-knowledge, where a subtree is held LOOSER so nesting
  // reads as nesting — at the leaf scale the nodes are small enough that a
  // looser hold would just read as noise rather than as structure.
  'knowledge-parent': 0.8,
  // Long and weak on purpose. This is the only edge that crosses clusters, and
  // the cluster layout depends on repulsion staying local — a relation should
  // bend the arrangement, not drag two clusters into one.
  //
  // As weak as core-type, and for the same reason: at anything nearer
  // type-knowledge's stiffness this becomes a placement force instead of a
  // tether, and a placement force pulling across clusters is exactly the star
  // this design undid. A synthetic sweep at ~1 relation per 5 knowledges, most
  // of them cross-cluster (the case that stresses this the most), holds
  // outward bias at 0.07-0.12 across 142-1232 nodes — inside the "well under
  // 0.2" ceiling though above the pre-relation 0.03-0.07 band — with the
  // closest type pair staying 1.5-2x the cluster radius apart at every scale.
  // 0.05, the strength type-knowledge's own distance would suggest by
  // analogy, measured outward bias above 0.15 at the 1000-node budget and is
  // not used here.
  //
  // 0.005 is not the sweep's best-measured value — it is the largest value
  // that still reads as a tether rather than a placement force, chosen to
  // match core-type for the same reason. Smaller values also pass and some
  // measure marginally better: 0.002 held outward bias to 0.101-0.106 (vs
  // 0.005's 0.120-0.129 in that same distance sweep) with an equal or better
  // type-gap ratio at the 1000-node budget. Re-deriving a "better" number from
  // the sweep alone is not a sign this value has drifted; it is choosing
  // between several passing candidates on different grounds than the sweep
  // optimizes for.
  'knowledge-knowledge': 0.005,
};
export const DEFAULT_LINK_STRENGTH = 0.3;

/**
 * The core is the hub every branch hangs from, so a charge on it is a force
 * pointing away from the scene's centre applied to every node at once — the
 * exact shape we do not want. It is 0 rather than absent because `chargeFor`
 * falls back with `??`: deleting the entry would quietly restore DEFAULT_CHARGE
 * and with it a weaker version of the same radial push.
 *
 * The core still earns its place in the simulation — it holds the type branches
 * into one connected component and is the recenter target — it just no longer
 * pushes.
 */
export const TIER_CHARGE: Record<KnowledgeNodeTier, number> = {
  core: 0,
  type: -480,
  knowledge: -40,
};
export const DEFAULT_CHARGE = -60;

/**
 * The other half of the anti-star fix, and the more important one.
 *
 * d3's many-body force is unbounded by default: every node repels every other
 * node at any separation. Summed over a scene, those long-range terms cancel
 * tangentially and reinforce radially, so the net force on any node points away
 * from the centre of mass — the layout is a star before a single link is
 * considered.
 *
 * Capping the range makes repulsion a local, cluster-scale effect: nodes
 * separate from their neighbours and are indifferent to clusters further off.
 * Local repulsion fills a volume; global repulsion projects onto a shell.
 *
 * 110 is the balance point, and it is a real trade-off in both directions.
 * Lower and neighbouring clusters stop shouldering each other apart and
 * interpenetrate into mush; higher and clusters separate cleanly while the star
 * creeps back. Measured over a sweep at the 1000-node budget, 110 holds the lean
 * at ~0.07 (against ~0.81 for the original unbounded charge, where 0 is a
 * direction-agnostic cloud and 1 is every leaf pointing straight outward) with
 * the closest pair of types ~111 apart against a cluster radius of ~53.
 *
 * It is therefore coupled to LINK_DISTANCE['type-knowledge']: raising the leaf
 * distance grows the clusters, and this has to grow with it or they merge.
 */
export const CHARGE_DISTANCE_MAX = 110;

/**
 * Pins every type and knowledge node onto the surface of one sphere, via a
 * `forceRadial` registered alongside `link`/`charge` in the canvas's force
 * effect. Requested explicitly in place of the organic-cluster layout above —
 * see `docs/superpowers/specs/2026-08-02-knowledge-graph-organic-clusters-design.md`
 * for why that layout exists: an earlier shell placed only TYPE nodes on it
 * while KNOWLEDGE leaves hung further out on short links, so each cluster
 * pointed radially outward past the shell — a dandelion.
 *
 * Applying the SAME radius to both tiers is what avoids that: a leaf has
 * nowhere radial left to go relative to its type, so `type-knowledge`'s link
 * (distance 32, strength 0.7) and `charge`'s capped repulsion resolve entirely
 * tangentially, across the shell surface, rather than as an outward spike.
 * Reusing `LINK_DISTANCE['core-type']` rather than introducing an unrelated
 * number keeps the shell at the radius the layout was already framed for
 * (`FOCUS_DISTANCE.core`).
 */
export const SPHERE_RADIUS = LINK_DISTANCE['core-type'];

/**
 * Strength of the radial pin, not the shell's radius. High enough that nodes
 * visibly sit on the sphere rather than drift through the volume the charge
 * force would otherwise fill, but short of 1 so it settles smoothly alongside
 * the stiff `type-knowledge` link instead of fighting it rigidly every tick.
 */
export const SPHERE_RADIAL_STRENGTH = 0.7;

/**
 * The core sits at the origin and is excluded — pulling the hub onto the same
 * shell as everything hanging off it would collapse the sphere's one
 * meaningful landmark into just another point on its surface.
 */
export const radialStrengthFor = (tier: string): number =>
  tier === 'core' ? 0 : SPHERE_RADIAL_STRENGTH;

export const FOCUS_DISTANCE: Record<KnowledgeNodeTier, number> = {
  // Unchanged: the cluster layout's extent runs ~352 at a dozen types to ~515
  // at the node budget, bracketing the ~503 this was framing before, so there is
  // nothing to compensate for.
  core: 420,
  // Tracks the cluster's rendered radius (~53), not the link distance — see the
  // note on LINK_DISTANCE['type-knowledge'] for why the two differ. This frames
  // a single cluster, so it has to follow what the cluster actually measures.
  type: 120,
  knowledge: 90,
};
export const DEFAULT_FOCUS_DISTANCE = 150;

/**
 * Every tier-keyed lookup below is total on purpose. An unknown tier returning
 * undefined makes d3 compute NaN positions; every node collapses to NaN and the
 * scene renders empty with no error at all — the hardest failure in this design
 * to diagnose. The `??` fallbacks degrade an unknown tier to a neutral node.
 */
export const nodeValFor = (tier: string, degree: number): number =>
  NODE_VAL[tier as KnowledgeNodeTier]?.(degree) ?? DEFAULT_NODE_VAL;

export const linkDistanceFor = (tier: string): number =>
  LINK_DISTANCE[tier as KnowledgeLinkTier] ?? DEFAULT_LINK_DISTANCE;

export const linkStrengthFor = (tier: string): number =>
  LINK_STRENGTH[tier as KnowledgeLinkTier] ?? DEFAULT_LINK_STRENGTH;

export const chargeFor = (tier: string): number =>
  TIER_CHARGE[tier as KnowledgeNodeTier] ?? DEFAULT_CHARGE;

export const focusDistanceFor = (tier: string): number =>
  FOCUS_DISTANCE[tier as KnowledgeNodeTier] ?? DEFAULT_FOCUS_DISTANCE;

export interface IVector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A camera position holding `distance` from `target`, along the direction the
 * camera already views it from. Preserving the direction is the point: framing
 * the core should change where the camera looks, not swing the scene round to
 * one canonical angle underneath the user.
 *
 * This is why the focus path's `position * (1 + distance / |position|)` cannot
 * simply be reused to frame the core. That form scales the node's own position
 * vector, which works only for a node sitting away from the origin; the core is
 * the hub every branch hangs from and sits at roughly (0,0,0), where scaling
 * leaves the camera inside the node.
 */
export const standoffPosition = (
  camera: IVector3,
  target: IVector3,
  distance: number
): IVector3 => {
  const dx = camera.x - target.x;
  const dy = camera.y - target.y;
  const dz = camera.z - target.z;
  const length = Math.hypot(dx, dy, dz);
  // `!(length > 0)` rather than `length === 0`, so a NaN coordinate takes this
  // branch too instead of propagating NaN into the camera — see the note above
  // on how invisible NaN failures are here.
  if (!(length > 0)) {
    return { x: target.x, y: target.y, z: target.z + distance };
  }
  const scale = distance / length;
  return {
    x: target.x + dx * scale,
    y: target.y + dy * scale,
    z: target.z + dz * scale,
  };
};

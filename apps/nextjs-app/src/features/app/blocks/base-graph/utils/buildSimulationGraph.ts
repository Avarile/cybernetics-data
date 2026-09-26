import type {
  IBaseGraphExpandVo,
  IBaseGraphLink,
  IBaseGraphNode,
  IBaseGraphVo,
} from '@teable/openapi';
import type { VisualLinkTier, VisualNodeTier } from './visualTier';
import { groupTargetTables, linkTierOf, nodeTierOf } from './visualTier';

export interface ISimulationNode extends IBaseGraphNode {
  tier: VisualNodeTier;
  // Written by the force simulation, not by us.
  x?: number;
  y?: number;
  z?: number;
}

export interface ISimulationLink extends IBaseGraphLink {
  tier: VisualLinkTier;
}

export interface ISimulationGraph {
  nodes: ISimulationNode[];
  links: ISimulationLink[];
}

export interface IHiddenState {
  /** EXCLUSIONS the user clicked — a node hides its whole structural subtree. */
  hiddenNodeIds: readonly string[];
  hiddenTableIds: readonly string[];
}

export const EMPTY_SIMULATION_GRAPH: ISimulationGraph = { nodes: [], links: [] };

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The server graph plus every expansion the user asked for. The base graph wins
 * a duplicate node; an expansion edge is dropped if the pair is already joined,
 * whichever field joined it — the client cannot tell the two sides of a
 * two-way link apart, and one edge per pair is what the server draws too.
 */
export const mergeExpansions = (
  graph: Pick<IBaseGraphVo, 'nodes' | 'links'>,
  expansions: readonly IBaseGraphExpandVo[]
): Pick<IBaseGraphVo, 'nodes' | 'links'> => {
  if (!expansions.length) return graph;
  const nodes = [...graph.nodes];
  const links = [...graph.links];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const pairs = new Set(links.map((l) => pairKey(l.source, l.target)));
  for (const expansion of expansions) {
    for (const node of expansion.nodes) {
      if (!nodeIds.has(node.id)) {
        nodeIds.add(node.id);
        nodes.push(node);
      }
    }
    for (const link of expansion.links) {
      const key = pairKey(link.source, link.target);
      if (!pairs.has(key) && nodeIds.has(link.source) && nodeIds.has(link.target)) {
        pairs.add(key);
        links.push(link);
      }
    }
  }
  return { nodes, links };
};

/**
 * Expands the user's exclusions to every structural descendant. Iterates to a
 * fixpoint rather than trusting emission order, so the client's filter does not
 * silently depend on how the server orders nodes.
 */
export const hiddenClosure = (
  nodes: readonly Pick<IBaseGraphNode, 'id' | 'kind' | 'tableId' | 'parentId'>[],
  hidden: IHiddenState
): Set<string> => {
  const out = new Set(hidden.hiddenNodeIds);
  const tables = new Set(hidden.hiddenTableIds);
  const cascadable = nodes.filter((node) => node.kind !== 'base');
  for (const node of cascadable) {
    if (node.tableId && tables.has(node.tableId)) out.add(node.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of cascadable) {
      if (!out.has(node.id) && node.parentId && out.has(node.parentId)) {
        out.add(node.id);
        changed = true;
      }
    }
  }
  return out;
};

/**
 * Derives the renderable graph from (server data × expansions × view state).
 * Never stored: identity stability is the performance contract, since
 * react-force-graph diffs graphData by reference.
 *
 * Every node and link is cloned: react-force-graph MUTATES what it is given —
 * x/y/z on nodes, object references on link endpoints — and handing it the
 * react-query cache would corrupt that cache.
 */
export const buildSimulationGraph = (
  graph: Pick<IBaseGraphVo, 'nodes' | 'links'> | undefined,
  hidden: IHiddenState,
  expansions: readonly IBaseGraphExpandVo[] = []
): ISimulationGraph => {
  if (!graph) return EMPTY_SIMULATION_GRAPH;
  const merged = mergeExpansions(graph, expansions);
  const closure = hiddenClosure(merged.nodes, hidden);
  const typeTables = groupTargetTables(merged.nodes, merged.links);

  const nodes: ISimulationNode[] = merged.nodes
    .filter((node) => node.kind === 'base' || !closure.has(node.id))
    .map((node) => ({ ...node, tier: nodeTierOf(node, typeTables) }));
  const tierById = new Map(nodes.map((n) => [n.id, n.tier]));
  const links: ISimulationLink[] = merged.links
    .filter((link) => tierById.has(link.source) && tierById.has(link.target))
    .map((link) => ({ ...link, tier: linkTierOf(link, (id) => tierById.get(id)) }));

  return { nodes, links };
};

/**
 * The base hub is kept in the simulation but never drawn: three-forcegraph
 * feeds every node to the forces while only rendering the visible ones, so an
 * invisible hub goes on holding the branches into one connected layout.
 */
export const isNodeVisible = (node: Pick<ISimulationNode, 'tier'>): boolean => node.tier !== 'core';

export const isLinkVisible = (link: Pick<ISimulationLink, 'tier'>): boolean =>
  link.tier !== 'core-type';

/** After the first tick, link endpoints are node objects rather than ids. */
export const linkEndpointId = (endpoint: string | { id?: string } | undefined): string => {
  if (typeof endpoint === 'string') return endpoint;
  return endpoint?.id ?? '';
};

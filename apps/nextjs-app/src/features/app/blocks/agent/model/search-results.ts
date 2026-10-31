import type { ICockpitSearchResult, ISearchTone } from '@teable/openapi';
import type { IGNode, IGraph } from './graph/types';

/** Results the chart draws for sure (scope design §7.3): the first ones, then the clicked ones. */
export const FORCED_MAX = 10;

/** An overview node of a record, as the server names it when the chart does not have it yet. */
export const nodeIdOf = (recordId: string) => `rec:${recordId}`;

/** The chart's nodes by the record they draw. */
const byRecord = (graph: IGraph) => {
  const map = new Map<string, IGNode>();
  for (const n of graph.nodes) if (n.recordId && !map.has(n.recordId)) map.set(n.recordId, n);
  return map;
};

/** The id of the node that draws a record, on this chart or as the server will name it. */
export const nodeOf = (graph: IGraph | undefined, recordId: string) =>
  (graph && byRecord(graph).get(recordId)?.id) ?? nodeIdOf(recordId);

/** When results land: the first of them are forced onto the chart. */
export const forcedOf = (results: ICockpitSearchResult[]) =>
  results.slice(0, FORCED_MAX).map((r) => r.recordId);

/** A clicked result goes to the front; the oldest leaves past the cap. */
export const forceFirst = (forced: string[], recordId: string) =>
  [recordId, ...forced.filter((id) => id !== recordId)].slice(0, FORCED_MAX);

/** One row of the Search Results panel. */
export interface IResultRow extends ICockpitSearchResult {
  /** Drawn on the chart now, and its tone there. */
  onChart: boolean;
  tone?: ISearchTone;
}

/** The results with where they stand on the chart. */
export const resultRows = (results: ICockpitSearchResult[], graph?: IGraph): IResultRow[] => {
  const nodes = graph ? byRecord(graph) : undefined;
  return results.map((r) => {
    const node = nodes?.get(r.recordId);
    return {
      ...r,
      onChart: Boolean(node),
      ...(node && node.tone !== 'none' ? { tone: node.tone } : {}),
    };
  });
};

/** Node ids of the results that are on the chart: ringed, and lit when nothing else is. */
export const markedOf = (results: ICockpitSearchResult[], graph?: IGraph) => {
  if (!graph) return undefined;
  const nodes = byRecord(graph);
  const ids = results.map((r) => nodes.get(r.recordId)?.id).filter((id): id is string => !!id);
  return ids.length ? new Set(ids) : undefined;
};

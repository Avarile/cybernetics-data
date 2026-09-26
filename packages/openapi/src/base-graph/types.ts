import { z } from '../zod';

/**
 * Payload shape version for the schema-driven base graph. Starts at 4 because
 * it supersedes the knowledge graph (v3): a client that understood v3 tiers
 * cannot read v4 kinds, and the jump makes that visible.
 */
export const BASE_GRAPH_VERSION = 4;

/** `rec:<recordId>` — record ids are globally unique, `tableId` travels in the node. */
export const RECORD_NODE_PREFIX = 'rec:';
/** `tbl:<tableId>` — optional hub tethering a table's root records. */
export const TABLE_NODE_PREFIX = 'tbl:';
/**
 * `grp:<fieldId>:<recordId>` — a group bucket whose target table is not in the
 * graph, so it has no record node of its own. `grp:<fieldId>:__none__` holds
 * the records whose group cell is empty or unresolvable.
 */
export const GROUP_NODE_PREFIX = 'grp:';
export const GROUP_NONE_SUFFIX = '__none__';
/** Optional base hub tethering every table hub and synthetic group. */
export const BASE_NODE_ID = 'base';

export const recordNodeId = (recordId: string) => `${RECORD_NODE_PREFIX}${recordId}`;
export const tableNodeId = (tableId: string) => `${TABLE_NODE_PREFIX}${tableId}`;
export const groupNodeId = (fieldId: string, recordId: string | null) =>
  `${GROUP_NODE_PREFIX}${fieldId}:${recordId ?? GROUP_NONE_SUFFIX}`;

export const GraphNodeKindValues = ['base', 'table', 'group', 'record'] as const;
export type GraphNodeKind = (typeof GraphNodeKindValues)[number];
export const graphNodeKindSchema = z.enum(GraphNodeKindValues);

/**
 * `hub`, `group` and `hierarchy` are structural — every node has at most one
 * structural parent, and the link budget never drops them. `link` edges come
 * from Link field values and are the only kind truncated by the budget.
 */
export const GraphLinkKindValues = ['hub', 'group', 'hierarchy', 'link'] as const;
export type GraphLinkKind = (typeof GraphLinkKindValues)[number];
export const graphLinkKindSchema = z.enum(GraphLinkKindValues);

export const baseGraphNodeSchema = z.object({
  id: z
    .string()
    .meta({ description: 'base | tbl:<tableId> | grp:<fieldId>:<recordId> | rec:<recordId>' }),
  kind: graphNodeKindSchema,
  tableId: z.string().nullable().meta({ description: 'Owning table; null for the base hub.' }),
  recordId: z
    .string()
    .nullable()
    .meta({ description: 'Backing record id; null for hubs and synthetic groups.' }),
  label: z.string(),
  parentId: z.string().nullable().meta({ description: 'The single structural parent, if any.' }),
  colorKey: z.string().nullable().meta({
    description:
      'Id of the top-most non-hub structural ancestor (or tbl:<tableId>). A whole subtree shares a hue family.',
  }),
  depth: z.number().int(),
  degree: z.number().int().meta({ description: 'Adjacent node count, precomputed for sizing.' }),
});
export type IBaseGraphNode = z.infer<typeof baseGraphNodeSchema>;

export const baseGraphLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  kind: graphLinkKindSchema,
  fieldId: z
    .string()
    .nullable()
    .meta({ description: 'The Link field behind the edge; null for hubs.' }),
});
export type IBaseGraphLink = z.infer<typeof baseGraphLinkSchema>;

export const baseGraphTableStatsSchema = z.object({
  tableId: z.string(),
  emitted: z.number().int(),
  truncated: z.boolean(),
});

export const baseGraphStatsSchema = z.object({
  perTable: baseGraphTableStatsSchema.array(),
  nodeCount: z.number().int(),
  linkCount: z.number().int(),
  truncated: z.object({ nodes: z.boolean(), links: z.boolean() }),
  cyclesDropped: z.number().int(),
  danglingLinks: z.number().int().meta({
    description: 'Link values dropped: self-links or targets outside the emitted set.',
  }),
  groupOrphans: z.number().int().meta({
    description: 'Root records whose group cell was empty or pointed outside the emitted set.',
  }),
});
export type IBaseGraphStats = z.infer<typeof baseGraphStatsSchema>;

import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { searchToneSchema } from './search';

/**
 * Overview design §8.3: one dataset of the data base drawn as a constellation, the cockpit's
 * default stage. Nodes are already encoded (tone, size, alert), so the cockpit only draws them.
 */

export const overviewDatasetSchema = z.enum(['work', 'knowledge', 'people', 'finance']);
export type IOverviewDatasetId = z.infer<typeof overviewDatasetSchema>;
export const OVERVIEW_DATASETS = overviewDatasetSchema.options;

export const overviewNodeSchema = z.object({
  /** rec:<recordId> or grp:<fieldId>:<…> from the base graph, or hub:<tableId> for a table's hub. */
  id: z.string(),
  kind: z.enum(['item', 'hub', 'actor']),
  label: z.string(),
  /** A key shown before the label, e.g. "TASK". */
  short: z.string().nullable(),
  parent: z.string().nullable(),
  tone: searchToneSchema,
  /** The status-like value the tone came from. */
  state: z.string().optional(),
  /** A deadline passed on something not settled. */
  alert: z.boolean().optional(),
  /** 0-4: priority or amount. */
  size: z.number().optional(),
  /** ISO date the tone, the readout and the draw budget use. */
  date: z.string().optional(),
  amount: z.number().optional(),
  recordId: z.string().optional(),
  tableId: z.string().optional(),
  table: z.string().optional(),
  /** Tooltip lines. */
  meta: z.array(z.tuple([z.string(), z.string()])).optional(),
});
export type IOverviewNode = z.infer<typeof overviewNodeSchema>;

export const overviewLinkSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  tone: searchToneSchema,
  /** The link field's name. */
  label: z.string(),
});
export type IOverviewLink = z.infer<typeof overviewLinkSchema>;

/** What every overview carries, a dataset's or a table's: the drawn graph and its counts. */
export const overviewGraphVoSchema = z.object({
  title: z.string(),
  /** How the dataset hangs together, e.g. "GOAL → PROJECT → TASK · EDGES = PEOPLE". */
  path: z.string(),
  baseId: z.string(),
  nodes: z.array(overviewNodeSchema),
  links: z.array(overviewLinkSchema),
  /** Records drawn per table, and `<table>.unplaced`: records read but not drawn (no parent). */
  counts: z.record(z.string(), z.number().int()),
  /** Tables or fields of the dataset the base does not have. */
  missing: z.array(z.string()),
  /** A table had more records than the dataset reads. */
  truncated: z.boolean(),
});
export type IOverviewGraphVo = z.infer<typeof overviewGraphVoSchema>;

export const agentOverviewVoSchema = overviewGraphVoSchema.extend({
  dataset: overviewDatasetSchema,
  builtAt: z.string(),
});
export type IAgentOverviewVo = z.infer<typeof agentOverviewVoSchema>;

export const AGENT_OVERVIEW = '/agent/overview/{dataset}';

export const AgentOverviewGetRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_OVERVIEW,
  description: 'One dataset of the data base as a constellation, for the cockpit (admin only)',
  request: { params: z.object({ dataset: overviewDatasetSchema }) },
  responses: {
    200: {
      description: 'Overview',
      content: { 'application/json': { schema: agentOverviewVoSchema } },
    },
  },
  tags: ['agent'],
});

export const getAgentOverview = async (dataset: IOverviewDatasetId) =>
  (await axios.get<IAgentOverviewVo>(urlBuilder(AGENT_OVERVIEW, { dataset }))).data;

/**
 * Scope design §9: one table of a base as a constellation, the stage the cockpit rotates through.
 * A table that anchors a curated dataset is drawn by it (`preset`); any other by a preset derived
 * from its schema. `presentation` holds what the rail and the legend say about it.
 */
export const overviewLegendEntrySchema = z.union([
  z.tuple([z.string(), z.string()]),
  z.tuple([z.string(), z.string(), z.enum(['ring', 'halo', 'diamond', 'hatch'])]),
]);
export type IOverviewLegendEntry = z.infer<typeof overviewLegendEntrySchema>;

export const overviewPresentationSchema = z.object({
  /** The vectors panel's title, e.g. TYPES. */
  branchTitle: z.string(),
  /** What a branch counts, e.g. ENTRIES. */
  unit: z.string(),
  /** A vector's right-hand figure: the share done, or the money moved. */
  right: z.enum(['pct', 'sum']).optional(),
  /** What each tone means on this table, for the vectors' facts. */
  toneNames: z.record(z.string(), z.string()),
  legend: z.array(overviewLegendEntrySchema),
});
export type IOverviewPresentation = z.infer<typeof overviewPresentationSchema>;

export const agentTableOverviewVoSchema = overviewGraphVoSchema.extend({
  tableId: z.string(),
  tableName: z.string(),
  /** The curated dataset that draws this table, or null for a derived preset. */
  preset: overviewDatasetSchema.nullable(),
  presentation: overviewPresentationSchema,
  builtAt: z.string(),
});
export type IAgentTableOverviewVo = z.infer<typeof agentTableOverviewVoSchema>;

/** Records the cockpit draws for sure (its forced search results), at most. */
export const OVERVIEW_FORCED_MAX = 10;

export const overviewNodesRoSchema = z.object({
  recordIds: z.array(z.string().startsWith('rec')).min(1).max(OVERVIEW_FORCED_MAX),
});
export type IOverviewNodesRo = z.infer<typeof overviewNodesRoSchema>;

export const overviewNodesVoSchema = z.object({
  nodes: z.array(overviewNodeSchema),
  links: z.array(overviewLinkSchema),
});
export type IOverviewNodesVo = z.infer<typeof overviewNodesVoSchema>;

export const AGENT_TABLE_OVERVIEW = '/agent/overview/tables/{tableId}';
export const AGENT_TABLE_OVERVIEW_NODES = '/agent/overview/tables/{tableId}/nodes';

const tableParams = z.object({ tableId: z.string().startsWith('tbl') });

export const AgentTableOverviewGetRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_TABLE_OVERVIEW,
  description: 'One table of a base as a constellation, for the cockpit (admin only)',
  request: { params: tableParams },
  responses: {
    200: {
      description: 'Table overview',
      content: { 'application/json': { schema: agentTableOverviewVoSchema } },
    },
  },
  tags: ['agent'],
});

export const AgentTableOverviewNodesRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_TABLE_OVERVIEW_NODES,
  description:
    "Records of a table encoded as the table overview draws them, with their parents: the cockpit's forced results",
  request: {
    params: tableParams,
    body: { content: { 'application/json': { schema: overviewNodesRoSchema } } },
  },
  responses: {
    200: {
      description: 'Nodes and links',
      content: { 'application/json': { schema: overviewNodesVoSchema } },
    },
  },
  tags: ['agent'],
});

export const getAgentTableOverview = async (tableId: string) =>
  (await axios.get<IAgentTableOverviewVo>(urlBuilder(AGENT_TABLE_OVERVIEW, { tableId }))).data;

export const getAgentTableOverviewNodes = async (tableId: string, ro: IOverviewNodesRo) =>
  (await axios.post<IOverviewNodesVo>(urlBuilder(AGENT_TABLE_OVERVIEW_NODES, { tableId }), ro))
    .data;

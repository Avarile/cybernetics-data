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

export const agentOverviewVoSchema = z.object({
  dataset: overviewDatasetSchema,
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

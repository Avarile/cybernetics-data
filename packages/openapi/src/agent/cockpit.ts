import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

/**
 * Scope design §10: the cockpit's base and table scope, its table search (the table page's
 * Search) and the record reader with the agent's summary. Admin only.
 */

/** A record's context is summarised by the agent when it is longer than this (characters). */
export const SUMMARY_MIN_CHARS = 500;
/** Search results a query returns at most; the total says how many match. */
export const COCKPIT_SEARCH_TAKE = 50;
export const COCKPIT_QUERY_MAX = 200;

const tags = ['agent'];
const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { 'application/json': { schema } },
});

export const AGENT_COCKPIT_BASES = '/agent/cockpit/bases';
export const AGENT_COCKPIT_TABLES = '/agent/cockpit/bases/{baseId}/tables';
export const AGENT_COCKPIT_DEFAULT_BASE = '/agent/cockpit/default-base';
export const AGENT_COCKPIT_SEARCH = '/agent/cockpit/tables/{tableId}/search';
export const AGENT_COCKPIT_RECORD = '/agent/cockpit/tables/{tableId}/records/{recordId}';
export const AGENT_COCKPIT_SUMMARY = '/agent/cockpit/tables/{tableId}/records/{recordId}/summary';

export const cockpitBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
  spaceName: z.string(),
});
export type ICockpitBase = z.infer<typeof cockpitBaseSchema>;

export const cockpitBasesVoSchema = z.object({
  bases: z.array(cockpitBaseSchema),
  /** The base the cockpit starts on: agent_setup.data_base_id, else the one the agent reads. */
  defaultBaseId: z.string().nullable(),
});
export type ICockpitBasesVo = z.infer<typeof cockpitBasesVoSchema>;

export const cockpitTableSchema = z.object({ id: z.string(), name: z.string() });
export type ICockpitTable = z.infer<typeof cockpitTableSchema>;

export const cockpitTablesVoSchema = z.object({
  baseId: z.string(),
  tables: z.array(cockpitTableSchema),
});
export type ICockpitTablesVo = z.infer<typeof cockpitTablesVoSchema>;

export const setDefaultBaseRoSchema = z.object({ baseId: z.string().startsWith('bse') });
export type ISetDefaultBaseRo = z.infer<typeof setDefaultBaseRoSchema>;

export const setDefaultBaseVoSchema = z.object({ defaultBaseId: z.string() });
export type ISetDefaultBaseVo = z.infer<typeof setDefaultBaseVoSchema>;

export const cockpitSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(COCKPIT_QUERY_MAX),
  take: z.coerce.number().int().min(1).max(COCKPIT_SEARCH_TAKE).optional(),
});
export type ICockpitSearchQuery = z.infer<typeof cockpitSearchQuerySchema>;

export const cockpitSearchResultSchema = z.object({
  recordId: z.string(),
  /** The primary field as text. */
  title: z.string(),
  /** The first field (after the title) whose text holds the query, cut around the match. */
  snippet: z
    .object({
      field: z.string(),
      text: z.string(),
      /** [start, end) of the match in `text`. */
      match: z.tuple([z.number().int(), z.number().int()]),
    })
    .nullable(),
  updatedAt: z.string().nullable(),
});
export type ICockpitSearchResult = z.infer<typeof cockpitSearchResultSchema>;

export const cockpitSearchVoSchema = z.object({
  tableId: z.string(),
  q: z.string(),
  /** Every record that matches; `results` holds the first of them. */
  total: z.number().int(),
  results: z.array(cockpitSearchResultSchema),
});
export type ICockpitSearchVo = z.infer<typeof cockpitSearchVoSchema>;

export const cockpitRecordVoSchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  baseId: z.string(),
  recordId: z.string(),
  title: z.string(),
  /** The record as Markdown, secret-looking fields masked. */
  markdown: z.string(),
  /** Length of the record's context: the title and every value shown, without the Markdown. */
  chars: z.number().int(),
  /** Changes whenever the record does (its last modified time). */
  version: z.string(),
  /** Fields whose values were masked. */
  masked: z.array(z.string()),
});
export type ICockpitRecordVo = z.infer<typeof cockpitRecordVoSchema>;

export const cockpitSummaryVoSchema = z.object({
  summary: z.string(),
  model: z.string(),
  cached: z.boolean(),
});
export type ICockpitSummaryVo = z.infer<typeof cockpitSummaryVoSchema>;

const baseParams = z.object({ baseId: z.string().startsWith('bse') });
const tableParams = z.object({ tableId: z.string().startsWith('tbl') });
const recordParams = tableParams.extend({ recordId: z.string().startsWith('rec') });

export const AgentCockpitBasesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_COCKPIT_BASES,
  description: 'Bases the admin can open (Agent space left out) and the default one',
  responses: { 200: { description: 'Bases', ...json(cockpitBasesVoSchema) } },
  tags,
});

export const AgentCockpitTablesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_COCKPIT_TABLES,
  description: 'Tables of a base in table order, system tables left out',
  request: { params: baseParams },
  responses: { 200: { description: 'Tables', ...json(cockpitTablesVoSchema) } },
  tags,
});

export const AgentCockpitDefaultBaseRoute: RouteConfig = registerRoute({
  method: 'put',
  path: AGENT_COCKPIT_DEFAULT_BASE,
  description: "Make a base the default: the cockpit starts on it and the agent's searches read it",
  request: { body: json(setDefaultBaseRoSchema) },
  responses: { 200: { description: 'The default base', ...json(setDefaultBaseVoSchema) } },
  tags,
});

export const AgentCockpitSearchRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_COCKPIT_SEARCH,
  description: "Search a table as the table page's Search does: every field, matching rows only",
  request: { params: tableParams, query: cockpitSearchQuerySchema },
  responses: { 200: { description: 'Results', ...json(cockpitSearchVoSchema) } },
  tags,
});

export const AgentCockpitRecordRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_COCKPIT_RECORD,
  description: 'A record as Markdown, for the cockpit’s reader',
  request: { params: recordParams },
  responses: { 200: { description: 'Record', ...json(cockpitRecordVoSchema) } },
  tags,
});

export const AgentCockpitSummaryRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_COCKPIT_SUMMARY,
  description: `The agent's spoken summary of a record longer than ${SUMMARY_MIN_CHARS} characters`,
  request: { params: recordParams },
  responses: { 200: { description: 'Summary', ...json(cockpitSummaryVoSchema) } },
  tags,
});

export const getCockpitBases = async () =>
  (await axios.get<ICockpitBasesVo>(AGENT_COCKPIT_BASES)).data;

export const getCockpitTables = async (baseId: string) =>
  (await axios.get<ICockpitTablesVo>(urlBuilder(AGENT_COCKPIT_TABLES, { baseId }))).data;

export const setCockpitDefaultBase = async (ro: ISetDefaultBaseRo) =>
  (await axios.put<ISetDefaultBaseVo>(AGENT_COCKPIT_DEFAULT_BASE, ro)).data;

export const searchCockpitTable = async (
  tableId: string,
  query: ICockpitSearchQuery,
  signal?: AbortSignal
) =>
  (
    await axios.get<ICockpitSearchVo>(urlBuilder(AGENT_COCKPIT_SEARCH, { tableId }), {
      params: query,
      signal,
    })
  ).data;

export const getCockpitRecord = async (tableId: string, recordId: string) =>
  (await axios.get<ICockpitRecordVo>(urlBuilder(AGENT_COCKPIT_RECORD, { tableId, recordId }))).data;

export const summarizeCockpitRecord = async (
  tableId: string,
  recordId: string,
  signal?: AbortSignal
) =>
  (
    await axios.post<ICockpitSummaryVo>(
      urlBuilder(AGENT_COCKPIT_SUMMARY, { tableId, recordId }),
      undefined,
      { signal }
    )
  ).data;

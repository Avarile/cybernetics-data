import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

/**
 * Agent cockpit design §6–§7: the search plan the agent makes for a question, the state of each
 * step, the record cards it finds, and the stream parts that carry them to the cockpit.
 */

export const searchIntentSchema = z.enum([
  'project_progress',
  'goal_progress',
  'task_lookup',
  'person_work',
  'knowledge_lookup',
  'finance_query',
  'record_lookup',
  'custom',
  'action',
]);
export type ISearchIntent = z.infer<typeof searchIntentSchema>;

/** Meaning of a state, as in the cockpit: settled, active, next, caution, backlog, faint. */
export const searchToneSchema = z.enum([
  'ink',
  'route',
  'target',
  'caution',
  'dim',
  'faint',
  'none',
]);
export type ISearchTone = z.infer<typeof searchToneSchema>;

const linkRefSchema = z.object({
  stepId: z.string(),
  /** A link field name: on the source step's table (follow) or on this step's table (reverse). */
  field: z.string(),
});

export const stepSourceSchema = z.discriminatedUnion('kind', [
  /** Anchor: title match plus full-text search, optionally narrowed by a Teable filter. */
  z.object({ kind: z.literal('search'), text: z.string().min(1).max(200), filter: z.unknown() }),
  /** Anchor pinned to known records, e.g. the option the admin picked. */
  z.object({ kind: z.literal('records'), recordIds: z.array(z.string()).min(1).max(100) }),
  /** A Teable filter over the table (fields by name). */
  z.object({
    kind: z.literal('filter'),
    filter: z.unknown(),
    orderBy: z
      .array(z.object({ field: z.string(), order: z.enum(['asc', 'desc']) }))
      .max(5)
      .optional(),
  }),
  /** The records in the link cells of earlier steps' records. */
  z.object({ kind: z.literal('follow'), from: z.array(linkRefSchema).min(1).max(6) }),
  /** The records of this table whose link field points at earlier steps' records. */
  z.object({ kind: z.literal('reverse'), from: z.array(linkRefSchema).min(1).max(6) }),
]);
export type IStepSource = z.infer<typeof stepSourceSchema>;

export const searchStepRoleSchema = z.enum(['anchor', 'related', 'actor', 'context']);
export type ISearchStepRole = z.infer<typeof searchStepRoleSchema>;

export const searchStepSchema = z.object({
  id: z.string(),
  table: z.object({ id: z.string(), name: z.string() }),
  role: searchStepRoleSchema,
  /** What the step is for, e.g. "tasks of the project". */
  purpose: z.string(),
  source: stepSourceSchema,
  /** Most cards sent for the step. */
  limit: z.number().int(),
  /** Number fields summed over the step's records (e.g. Amount), for the model. */
  totals: z.array(z.string()).optional(),
});
export type ISearchStep = z.infer<typeof searchStepSchema>;

export const searchPlanSchema = z.object({
  id: z.string(),
  intent: searchIntentSchema,
  summary: z.string(),
  baseId: z.string(),
  steps: z.array(searchStepSchema),
  /** Tables or fields the recipe expects that the base does not have. */
  missing: z.array(z.string()),
  /** Archived records (is_active off, deleted_at set) are searched too. */
  includeArchived: z.boolean().optional(),
});
export type ISearchPlan = z.infer<typeof searchPlanSchema>;

export const stepStatusSchema = z.enum([
  'pending',
  'running',
  'done',
  'empty',
  'needs_choice',
  'skipped',
  'failed',
  'cancelled',
]);
export type IStepStatus = z.infer<typeof stepStatusSchema>;

export const stepStateSchema = z.object({
  stepId: z.string(),
  status: stepStatusSchema,
  /** Records the step reached. */
  found: z.number().int(),
  /** Cards sent (at most the step's limit). */
  shown: z.number().int(),
  error: z.string().optional(),
});
export type IStepState = z.infer<typeof stepStateSchema>;

export const searchStatusSchema = z.enum([
  'planned',
  'running',
  'done',
  'needs_choice',
  'empty',
  'failed',
  'cancelled',
]);
export type ISearchStatus = z.infer<typeof searchStatusSchema>;

export const searchCardSchema = z.object({
  /** `${stepId}:${recordId}` */
  key: z.string(),
  stepId: z.string(),
  recordId: z.string(),
  tableId: z.string(),
  table: z.string(),
  title: z.string(),
  /** The table's short name and auto number, e.g. "TASK · #42". */
  short: z.string().nullable(),
  tone: searchToneSchema,
  /** The status-like value the tone came from, e.g. "in-progress". */
  state: z.string().optional(),
  /** 0-4: priority or amount. */
  size: z.number().optional(),
  alert: z.boolean().optional(),
  archived: z.boolean().optional(),
  fields: z.array(z.object({ name: z.string(), value: z.string() })),
  snippet: z.string().optional(),
  date: z.string().optional(),
  /** How the step reached the record. */
  via: z.object({ stepId: z.string(), recordId: z.string(), field: z.string() }).optional(),
  /** Link cells of the record (field name → record ids), for the constellation's edges. */
  links: z.record(z.string(), z.array(z.string())).optional(),
});
export type ISearchCard = z.infer<typeof searchCardSchema>;

/* ---------- stream parts (design §7.1) ---------- */

export const AGENT_DATA_PART = {
  run: 'data-run',
  searchPlan: 'data-search-plan',
  searchStep: 'data-search-step',
  searchHit: 'data-search-hit',
  searchLens: 'data-search-lens',
  clarify: 'data-clarify',
  choice: 'data-choice',
} as const;

/** Stored in the message, replaced (same id) as the steps progress. */
export const searchPlanPartSchema = z.object({
  searchId: z.string(),
  plan: searchPlanSchema,
  states: z.array(stepStateSchema),
  status: searchStatusSchema,
});
export type ISearchPlanPart = z.infer<typeof searchPlanPartSchema>;

/** Transient: a step started, finished or failed. */
export const searchStepPartSchema = z.object({ searchId: z.string(), state: stepStateSchema });
export type ISearchStepPart = z.infer<typeof searchStepPartSchema>;

/** Transient: one record card. */
export const searchHitPartSchema = z.object({ searchId: z.string(), card: searchCardSchema });
export type ISearchHitPart = z.infer<typeof searchHitPartSchema>;

export const searchViewSchema = z.enum(['board', 'constellation']);
export type ISearchView = z.infer<typeof searchViewSchema>;

/** Stored: the records the answer cites (card keys). */
export const searchLensPartSchema = z.object({
  searchId: z.string(),
  recordKeys: z.array(z.string()),
  view: searchViewSchema.optional(),
});
export type ISearchLensPart = z.infer<typeof searchLensPartSchema>;

export const recordRefSchema = z.object({
  tableId: z.string(),
  table: z.string(),
  recordId: z.string(),
});
export type IRecordRef = z.infer<typeof recordRefSchema>;

export const clarifyReasonSchema = z.enum(['intent', 'anchor', 'missing']);
export type IClarifyReason = z.infer<typeof clarifyReasonSchema>;

export const clarifyOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string().optional(),
  recordRef: recordRefSchema.optional(),
});
export type IClarifyOption = z.infer<typeof clarifyOptionSchema>;

/** Stored: the agent asks the admin before it goes on. */
export const clarifyPartSchema = z.object({
  clarifyId: z.string(),
  question: z.string(),
  reason: clarifyReasonSchema,
  options: z.array(clarifyOptionSchema),
});
export type IClarifyPart = z.infer<typeof clarifyPartSchema>;

/** Stored in the admin's message: the option they picked. */
export const choicePartSchema = z.object({
  clarifyId: z.string(),
  optionId: z.string(),
  label: z.string(),
  recordRef: recordRefSchema.optional(),
});
export type IChoicePart = z.infer<typeof choicePartSchema>;

/* ---------- replay (design §7.3) ---------- */

export const agentSearchVoSchema = z.object({
  id: z.string(),
  runId: z.string(),
  threadId: z.string(),
  intent: searchIntentSchema,
  plan: searchPlanSchema,
  states: z.array(stepStateSchema),
  cards: z.array(searchCardSchema),
  lens: z.array(z.string()),
  status: searchStatusSchema,
  createdAt: z.string(),
});
export type IAgentSearchVo = z.infer<typeof agentSearchVoSchema>;

export const agentSearchSummaryVoSchema = z.object({
  id: z.string(),
  runId: z.string(),
  intent: searchIntentSchema,
  summary: z.string(),
  status: searchStatusSchema,
  createdAt: z.string(),
});
export type IAgentSearchSummaryVo = z.infer<typeof agentSearchSummaryVoSchema>;

export const agentSearchListVoSchema = z.object({
  searches: z.array(agentSearchSummaryVoSchema),
});
export type IAgentSearchListVo = z.infer<typeof agentSearchListVoSchema>;

export const AGENT_SEARCH = '/agent/searches/{searchId}';
export const AGENT_THREAD_SEARCHES = '/agent/threads/{threadId}/searches';

const tags = ['agent'];

export const AgentSearchGetRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_SEARCH,
  description: 'A search the agent ran: its plan, step states and the cards it found',
  request: { params: z.object({ searchId: z.string() }) },
  responses: {
    200: {
      description: 'Search',
      content: { 'application/json': { schema: agentSearchVoSchema } },
    },
  },
  tags,
});

export const AgentThreadSearchesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_THREAD_SEARCHES,
  description: 'The searches of one of the caller’s threads, oldest first',
  request: { params: z.object({ threadId: z.string() }) },
  responses: {
    200: {
      description: 'Searches',
      content: { 'application/json': { schema: agentSearchListVoSchema } },
    },
  },
  tags,
});

export const getAgentSearch = async (searchId: string) =>
  (await axios.get<IAgentSearchVo>(urlBuilder(AGENT_SEARCH, { searchId }))).data;

export const listAgentThreadSearches = async (threadId: string) =>
  (await axios.get<IAgentSearchListVo>(urlBuilder(AGENT_THREAD_SEARCHES, { threadId }))).data;

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { aiDataClient } from './ai-data-client.js';
import type { AiDataRecord } from './ai-data-client.js';
import { TABLES, searchByTitle, searchContacts } from './ai-data-reads.js';
import { linkTitle } from './knowledges/link-cell.js';

/**
 * Two-round search tools. They read through the Teable backend as the chatting user
 * (see ai-data-client.ts), by table and field name.
 */

// ── Shared output types ────────────────────────────────────────────────────

const titleResult = z.object({ id: z.string(), title: z.string() });
const knowledgeTitleResult = titleResult.extend({ knowledge_type: z.string().optional() });

const contextResult = z.object({
  id: z.string(),
  title: z.string(),
  context: z.string().optional(),
});
const knowledgeContextResult = contextResult.extend({ knowledge_type: z.string().optional() });

const keywordInput = z.object({
  keyword: z.string().min(1).describe('Keyword to search for in titles (substring match)'),
  take: z.number().int().min(1).max(50).optional().default(20),
});

const idsInput = z.object({
  recordIds: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe('Teable record IDs (recXXX) — max 5, selected from Round 1 results'),
});

const text = (value: unknown) => (value ? String(value) : undefined);
const title = (r: AiDataRecord) => String(r.fields.title ?? '');
const toTitle = (r: AiDataRecord) => ({ id: r.id, title: title(r) });
const toContext = (r: AiDataRecord) => ({ ...toTitle(r), context: text(r.fields.context) });

/** Round 1 tool: titles containing the keyword. */
const titleSearchTool = (id: string, description: string, table: string) =>
  createTool({
    id,
    description,
    inputSchema: keywordInput,
    outputSchema: z.object({ results: z.array(titleResult), total: z.number() }),
    execute: async ({ keyword, take }, context) => {
      const records = await searchByTitle(aiDataClient(context), table, keyword, { take });
      return { results: records.map(toTitle), total: records.length };
    },
  });

/** Round 2 tool: title + context for the chosen ids. */
const contextTool = (id: string, description: string, table: string) =>
  createTool({
    id,
    description,
    inputSchema: idsInput,
    outputSchema: z.object({ records: z.array(contextResult) }),
    execute: async ({ recordIds }, context) => {
      const records = await aiDataClient(context).getRecordsByIds(table, recordIds);
      return { records: records.map(toContext) };
    },
  });

// ── Round 1 — Title search ─────────────────────────────────────────────────

export const searchKnowledgeTitlesTool = createTool({
  id: 'search-knowledge-titles',
  description:
    'ROUND 1 — Search knowledge records whose title contains the keyword. ' +
    'Returns id, title, and knowledge_type only. ' +
    'Pick the ≤5 most relevant results (considering both title and knowledge_type), ' +
    'then call get-knowledge-contexts with those IDs.',
  inputSchema: keywordInput,
  outputSchema: z.object({ results: z.array(knowledgeTitleResult), total: z.number() }),
  execute: async ({ keyword, take }, context) => {
    const records = await searchByTitle(aiDataClient(context), TABLES.knowledges, keyword, {
      take,
    });
    return {
      results: records.map((r) => ({
        ...toTitle(r),
        knowledge_type: linkTitle(r.fields.knowledge_type),
      })),
      total: records.length,
    };
  },
});

export const searchGoalTitlesTool = titleSearchTool(
  'search-goal-titles',
  'ROUND 1 — Search goal records whose title contains the keyword. ' +
    'Returns id and title only. ' +
    'Pick the ≤5 most relevant results, then call get-goal-contexts with those IDs.',
  TABLES.goals
);

export const searchProjectTitlesTool = titleSearchTool(
  'search-project-titles',
  'ROUND 1 — Search project records whose title contains the keyword. ' +
    'Returns id and title only. ' +
    'Pick the ≤5 most relevant results, then call get-project-contexts with those IDs.',
  TABLES.projects
);

export const searchTaskTitlesTool = titleSearchTool(
  'search-task-titles',
  'ROUND 1 — Search task records whose title contains the keyword. ' +
    'Returns id and title only. ' +
    'Pick the ≤5 most relevant results, then call get-task-contexts with those IDs.',
  TABLES.tasks
);

// ── Round 2 — Context fetch ────────────────────────────────────────────────

export const getKnowledgeContextsTool = createTool({
  id: 'get-knowledge-contexts',
  description:
    'ROUND 2 — Fetch full title + context for up to 5 knowledge records by their IDs. ' +
    'Call this after search-knowledge-titles with the IDs of the most relevant results.',
  inputSchema: idsInput,
  outputSchema: z.object({ records: z.array(knowledgeContextResult) }),
  execute: async ({ recordIds }, context) => {
    const records = await aiDataClient(context).getRecordsByIds(TABLES.knowledges, recordIds);
    return {
      records: records.map((r) => ({
        ...toContext(r),
        knowledge_type: linkTitle(r.fields.knowledge_type),
      })),
    };
  },
});

export const getGoalContextsTool = contextTool(
  'get-goal-contexts',
  'ROUND 2 — Fetch full title + context for up to 5 goal records by their IDs. ' +
    'Call this after search-goal-titles with the IDs of the most relevant results.',
  TABLES.goals
);

export const getProjectContextsTool = contextTool(
  'get-project-contexts',
  'ROUND 2 — Fetch full title + context for up to 5 project records by their IDs. ' +
    'Call this after search-project-titles with the IDs of the most relevant results.',
  TABLES.projects
);

export const getTaskContextsTool = contextTool(
  'get-task-contexts',
  'ROUND 2 — Fetch full title + context for up to 5 task records by their IDs. ' +
    'Call this after search-task-titles with the IDs of the most relevant results.',
  TABLES.tasks
);

// ── Contacts — Round 1 ─────────────────────────────────────────────────────

const contactTitleResult = titleResult.extend({ email: z.string().optional() });

export const searchContactTitlesTool = createTool({
  id: 'search-contact-titles',
  description:
    'ROUND 1 — Search contact records by name or email keyword. ' +
    'Returns id, title, and email only. ' +
    'Pick the ≤5 most relevant results, then call get-contact-contexts with those IDs.',
  inputSchema: keywordInput,
  outputSchema: z.object({ results: z.array(contactTitleResult), total: z.number() }),
  execute: async ({ keyword, take }, context) => {
    const records = await searchContacts(aiDataClient(context), keyword, { take });
    return {
      results: records.map((r) => ({ ...toTitle(r), email: text(r.fields.email) })),
      total: records.length,
    };
  },
});

export const searchCompanyTitlesTool = titleSearchTool(
  'search-company-titles',
  'ROUND 1 — Search company records whose title contains the keyword. ' +
    'Returns id and title only. ' +
    'Pick the ≤5 most relevant results, then call get-company-contexts with those IDs.',
  TABLES.companies
);

// ── Contacts — Round 2 ─────────────────────────────────────────────────────

const contactContextResult = z.object({
  id: z.string(),
  title: z.string(),
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  email: z.string().optional(),
  mobile: z.string().optional(),
  context: z.string().optional(),
});

export const getContactContextsTool = createTool({
  id: 'get-contact-contexts',
  description:
    'ROUND 2 — Fetch full contact details for up to 5 contact records by their IDs. ' +
    'Call this after search-contact-titles with the IDs of the most relevant results.',
  inputSchema: idsInput,
  outputSchema: z.object({ records: z.array(contactContextResult) }),
  execute: async ({ recordIds }, context) => {
    const records = await aiDataClient(context).getRecordsByIds(TABLES.contacts, recordIds);
    return {
      records: records.map((r) => ({
        ...toTitle(r),
        firstname: text(r.fields.firstname),
        lastname: text(r.fields.lastname),
        email: text(r.fields.email),
        mobile: text(r.fields.mobile),
        context: text(r.fields.context),
      })),
    };
  },
});

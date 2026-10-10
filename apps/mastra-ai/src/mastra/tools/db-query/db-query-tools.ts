import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { aiDataClient } from './ai-data-client.js';
import type { AiDataClient, AiDataRecord } from './ai-data-client.js';
import {
  TABLES,
  findByTitle,
  followLink,
  getById,
  linkedByOwnerTitle,
  listFrameworksByType,
  listRecords,
} from './ai-data-reads.js';

/**
 * Read tools. They read through the Teable backend as the chatting user (see
 * ai-data-client.ts); tables and fields are addressed by name, not hardcoded ids.
 * Soft-deleted rows (deleted_at set) are left out by the backend.
 */

const pagination = {
  take: z.number().int().min(1).max(200).optional().default(50),
  skip: z.number().int().min(0).optional(),
  search: z.string().optional().describe('Text search against record fields (e.g. title keyword)'),
};

const recordSchema = z.object({ id: z.string(), fields: z.record(z.string(), z.unknown()) });
const listOutput = z.object({ records: z.array(recordSchema), total: z.number() });

const asList = (records: AiDataRecord[]) => ({ records, total: records.length });

/** A list tool over one table with take / skip / search. */
const listTool = (id: string, description: string, table: string) =>
  createTool({
    id,
    description,
    inputSchema: z.object({ ...pagination }),
    outputSchema: listOutput,
    execute: async ({ take, skip, search }, context) =>
      asList(await listRecords(aiDataClient(context), table, { take, skip, search })),
  });

// ── Knowledge ──────────────────────────────────────────────────────────────

export const listKnowledgesTool = createTool({
  id: 'list-knowledges',
  description:
    'List structured knowledge records from the Teable database. ' +
    'Pass typeName to filter by knowledge type.',
  inputSchema: z.object({
    ...pagination,
    typeName: z.string().optional().describe('Filter by knowledge type title'),
  }),
  outputSchema: listOutput,
  execute: async ({ take, skip, search, typeName }, context) => {
    const client = aiDataClient(context);
    if (!typeName)
      return asList(await listRecords(client, TABLES.knowledges, { take, skip, search }));

    const type = await findByTitle(client, TABLES.knowledgeTypes, typeName);
    if (!type) return asList([]);
    return asList(
      await listRecords(client, TABLES.knowledges, {
        take,
        skip,
        search,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'knowledge_type', operator: 'is', value: type.id }],
        },
      })
    );
  },
});

export const listKnowledgeTypesTool = listTool(
  'list-knowledge-types',
  'List all knowledge type records (the taxonomy/categories for knowledge records).',
  TABLES.knowledgeTypes
);

// ── Goals / projects / tasks ───────────────────────────────────────────────

export const listGoalsTool = listTool(
  'list-goals',
  'List goal records. Pass search to filter by title keyword.',
  TABLES.goals
);

export const getGoalWithProjectsTool = createTool({
  id: 'get-goal-with-projects',
  description: 'Get a goal by its Teable record ID with all linked project records fully resolved.',
  inputSchema: z.object({
    goalRecordId: z.string().describe('Teable record ID of the goal (e.g. recXXX)'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    goal: recordSchema.optional(),
    projects: z.array(recordSchema).optional(),
  }),
  execute: async ({ goalRecordId }, context) => {
    const client = aiDataClient(context);
    const goal = await getById(client, TABLES.goals, goalRecordId);
    if (!goal) return { found: false };
    return {
      found: true,
      goal,
      projects: await followLink(client, TABLES.projects, goal.fields.projects),
    };
  },
});

export const listProjectsTool = listTool(
  'list-projects',
  'List project records. Pass search to filter by title keyword.',
  TABLES.projects
);

export const getProjectWithTasksTool = createTool({
  id: 'get-project-with-tasks',
  description: 'Get a project by its Teable record ID with all linked task records fully resolved.',
  inputSchema: z.object({
    projectRecordId: z.string().describe('Teable record ID of the project (e.g. recXXX)'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    project: recordSchema.optional(),
    tasks: z.array(recordSchema).optional(),
  }),
  execute: async ({ projectRecordId }, context) => {
    const client = aiDataClient(context);
    const project = await getById(client, TABLES.projects, projectRecordId);
    if (!project) return { found: false };
    return {
      found: true,
      project,
      tasks: await followLink(client, TABLES.tasks, project.fields.tasks),
    };
  },
});

export const listTasksTool = listTool(
  'list-tasks',
  'List task records. Pass search to filter by title keyword.',
  TABLES.tasks
);

export const getTaskTool = createTool({
  id: 'get-task',
  description: 'Get a single task by its Teable record ID.',
  inputSchema: z.object({
    taskRecordId: z.string().describe('Teable record ID of the task (e.g. recXXX)'),
  }),
  outputSchema: z.object({ found: z.boolean(), task: recordSchema.optional() }),
  execute: async ({ taskRecordId }, context) => {
    const task = await getById(aiDataClient(context), TABLES.tasks, taskRecordId);
    return task ? { found: true, task } : { found: false };
  },
});

// ── Frameworks ─────────────────────────────────────────────────────────────

export const listFrameworksTool = createTool({
  id: 'list-frameworks',
  description:
    'List framework records. Pass type to filter by category: ' +
    'goal-management, project-management, meeting-strategy, or conversation-strategy.',
  inputSchema: z.object({
    ...pagination,
    type: z
      .enum(['goal-management', 'project-management', 'meeting-strategy', 'conversation-strategy'])
      .optional()
      .describe('Framework category to filter by'),
  }),
  outputSchema: listOutput,
  execute: async ({ take, skip, search, type }, context) => {
    const client = aiDataClient(context);
    return asList(
      type
        ? await listFrameworksByType(client, type, { take, skip, search })
        : await listRecords(client, TABLES.frameworks, { take, skip, search })
    );
  },
});

// ── Contacts ───────────────────────────────────────────────────────────────

export const listContactTypesTool = listTool(
  'list-contact-types',
  'List all contact type records.',
  TABLES.contactTypes
);

export const listContactProfessionsTool = listTool(
  'list-contact-professions',
  'List all contact profession records.',
  TABLES.contactProfessions
);

export const listCompaniesTool = listTool(
  'list-companies',
  'List company records. Pass search to filter by title keyword.',
  TABLES.companies
);

export const listContactsTool = listTool(
  'list-contacts',
  'List contact records. Pass search to filter by title keyword.',
  TABLES.contacts
);

const firstLinked = async (client: AiDataClient, table: string, cell: unknown) =>
  (await followLink(client, table, Array.isArray(cell) ? cell.slice(0, 1) : cell))[0];

export const getContactWithRelationsTool = createTool({
  id: 'get-contact-with-relations',
  description:
    'Get a contact by its Teable record ID with linked type, profession, and company records fully resolved.',
  inputSchema: z.object({
    contactRecordId: z.string().describe('Teable record ID of the contact (e.g. recXXX)'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    contact: recordSchema.optional(),
    type: recordSchema.optional(),
    profession: recordSchema.optional(),
    company: recordSchema.optional(),
  }),
  execute: async ({ contactRecordId }, context) => {
    const client = aiDataClient(context);
    const contact = await getById(client, TABLES.contacts, contactRecordId);
    if (!contact) return { found: false };
    return {
      found: true,
      contact,
      type: await firstLinked(client, TABLES.contactTypes, contact.fields.contact_type),
      profession: await firstLinked(
        client,
        TABLES.contactProfessions,
        contact.fields.contact_profession
      ),
      company: await firstLinked(client, TABLES.companies, contact.fields.contact_company),
    };
  },
});

/** All contacts linked from the record titled `title` in `ownerTable` (its reverse `contacts` link). */
const contactsOfTool = (
  id: string,
  description: string,
  ownerTable: string,
  inputName: string,
  inputDescription: string
) =>
  createTool({
    id,
    description,
    inputSchema: z.object({ [inputName]: z.string().describe(inputDescription) }),
    outputSchema: listOutput,
    execute: async (input, context) =>
      asList(
        await linkedByOwnerTitle(
          aiDataClient(context),
          ownerTable,
          String((input as Record<string, unknown>)[inputName]),
          'contacts',
          TABLES.contacts
        )
      ),
  });

export const getContactsByTypeTool = contactsOfTool(
  'get-contacts-by-type',
  'Get all contacts linked to a given contact type title.',
  TABLES.contactTypes,
  'typeName',
  'Contact type title (e.g. "Lead")'
);

export const getContactsByProfessionTool = contactsOfTool(
  'get-contacts-by-profession',
  'Get all contacts linked to a given contact profession title.',
  TABLES.contactProfessions,
  'professionName',
  'Contact profession title (e.g. "Engineer")'
);

export const getContactsByCompanyTool = contactsOfTool(
  'get-contacts-by-company',
  'Get all contacts linked to a given company title.',
  TABLES.companies,
  'companyName',
  'Company title'
);

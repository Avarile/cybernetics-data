// NOT USED AT THE MOMENT: no agent registers these write tools (the Mastra agents are
// read-only). Kept for a future write gateway; see CYBERDATA-12.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createKnowledgeWithType } from './knowledges/knowledge-service.js';
import { createKnowledgeType } from './knowledges/knowledge-type.js';
import { createGoal } from './project-management/goals.js';
import { createProject } from './project-management/projects.js';
import { createTask } from './project-management/tasks.js';
import {
  createProjectUnderGoal,
  createTaskUnderProject,
} from './project-management/project-service.js';
import { createContactType } from './contacts/contact-type.js';
import { createContactProfession } from './contacts/contact-profession.js';
import { createCompany } from './contacts/companies.js';
import { createContactWithDependencies } from './contacts/contact-service.js';

const recordSchema = z.object({ id: z.string(), fields: z.record(z.string(), z.unknown()) });
const mutationOutput = z.object({
  success: z.boolean(),
  record: recordSchema.optional(),
  error: z.string().optional(),
});

// TeableRecord<T> has `fields: T` where T is a concrete interface without an index signature,
// making it not directly assignable to `Record<string, unknown>`. This cast is safe because
// all T values are plain objects whose keys are strings.
function toMutationRecord(r: { id: string; fields: unknown }): {
  id: string;
  fields: Record<string, unknown>;
} {
  return r as { id: string; fields: Record<string, unknown> };
}

// ── Knowledge ──────────────────────────────────────────────────────────────

export const createKnowledgeTool = createTool({
  id: 'create-knowledge',
  description:
    'Create a new structured knowledge record. The knowledge_type is auto-created if it does not exist.',
  inputSchema: z.object({
    title: z.string().min(1),
    context: z.string().optional(),
    is_active: z.boolean().optional().default(true),
    typeName: z.string().describe('Knowledge type title — created automatically if absent'),
    typeContext: z.string().optional().describe('Context for the type when it needs to be created'),
  }),
  outputSchema: mutationOutput,
  execute: async ({ title, context, is_active, typeName, typeContext }) => {
    try {
      const { knowledge } = await createKnowledgeWithType(
        { title, context, is_active },
        typeName,
        typeContext
      );
      return { success: true, record: toMutationRecord(knowledge) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Knowledge Type ─────────────────────────────────────────────────────────

export const createKnowledgeTypeTool = createTool({
  id: 'create-knowledge-type',
  description: 'Create a new knowledge type record.',
  inputSchema: z.object({
    title: z.string().min(1),
    context: z.string().optional(),
    is_active: z.boolean().optional().default(true),
  }),
  outputSchema: mutationOutput,
  execute: async ({ title, context, is_active }) => {
    try {
      const record = await createKnowledgeType({ title, context, is_active });
      return { success: true, record: toMutationRecord(record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Goal ───────────────────────────────────────────────────────────────────

export const createGoalTool = createTool({
  id: 'create-goal',
  description: 'Create a new goal record.',
  inputSchema: z.object({
    title: z.string().min(1),
    context: z.string().optional(),
    is_active: z.boolean().optional().default(true),
    deadline: z.string().optional().describe('ISO 8601 date string (e.g. 2025-12-31)'),
  }),
  outputSchema: mutationOutput,
  execute: async ({ title, context, is_active, deadline }) => {
    try {
      const record = await createGoal({ title, context, is_active, deadline });
      return { success: true, record: toMutationRecord(record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Project ────────────────────────────────────────────────────────────────

export const createProjectTool = createTool({
  id: 'create-project',
  description: 'Create a new project record. Pass goalRecordId to link it under an existing goal.',
  inputSchema: z.object({
    title: z.string().min(1),
    context: z.string().optional(),
    is_active: z.boolean().optional().default(true),
    progress: z
      .enum([
        'backlog',
        'preparing',
        'initiated',
        'in-progress',
        'finished-reviewing',
        'finished-validating',
        'finished-testing',
        'finalized',
        'onhold',
        'cancelled',
      ])
      .optional(),
    goalRecordId: z
      .string()
      .optional()
      .describe('Teable record ID of the parent goal (e.g. recXXX)'),
  }),
  outputSchema: mutationOutput,
  execute: async ({ title, context, is_active, progress, goalRecordId }) => {
    try {
      const record = goalRecordId
        ? (await createProjectUnderGoal({ title, context, is_active, progress }, goalRecordId))
            .project
        : await createProject({ title, context, is_active, progress });
      return { success: true, record: toMutationRecord(record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Task ───────────────────────────────────────────────────────────────────

export const createTaskTool = createTool({
  id: 'create-task',
  description:
    'Create a new task record. Pass projectRecordId to link it under an existing project.',
  inputSchema: z.object({
    title: z.string().min(1),
    context: z.string().optional(),
    is_active: z.boolean().optional().default(true),
    progress: z
      .enum([
        'backlog',
        'in-progress',
        'finished_reviewing',
        'finished_validating',
        'onhold',
        'cancelled',
      ])
      .optional(),
    priority: z.enum(['urgent', 'important', 'prioritise', 'normal', 'can wait']).optional(),
    started_at: z.string().optional().describe('ISO 8601 datetime'),
    finished_at: z.string().optional().describe('ISO 8601 datetime'),
    projectRecordId: z
      .string()
      .optional()
      .describe('Teable record ID of the parent project (e.g. recXXX)'),
  }),
  outputSchema: mutationOutput,
  execute: async ({
    title,
    context,
    is_active,
    progress,
    priority,
    started_at,
    finished_at,
    projectRecordId,
  }) => {
    try {
      const taskFields = { title, context, is_active, progress, priority, started_at, finished_at };
      const record = projectRecordId
        ? (await createTaskUnderProject(taskFields, projectRecordId)).task
        : await createTask(taskFields);
      return { success: true, record: toMutationRecord(record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Contact Type ────────────────────────────────────────────────────────────

export const createContactTypeTool = createTool({
  id: 'create-contact-type',
  description: 'Create a new contact type record (e.g. "Lead", "Client", "Partner").',
  inputSchema: z.object({
    title: z.string().min(1),
    context: z.string().optional(),
    is_active: z.boolean().optional().default(true),
  }),
  outputSchema: mutationOutput,
  execute: async ({ title, context, is_active }) => {
    try {
      const record = await createContactType({ title, context, is_active });
      return { success: true, record: toMutationRecord(record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Contact Profession ──────────────────────────────────────────────────────

export const createContactProfessionTool = createTool({
  id: 'create-contact-profession',
  description: 'Create a new contact profession record (e.g. "Engineer", "Designer", "Sales").',
  inputSchema: z.object({
    title: z.string().min(1),
    context: z.string().optional(),
    is_active: z.boolean().optional().default(true),
  }),
  outputSchema: mutationOutput,
  execute: async ({ title, context, is_active }) => {
    try {
      const record = await createContactProfession({ title, context, is_active });
      return { success: true, record: toMutationRecord(record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Company ─────────────────────────────────────────────────────────────────

export const createCompanyTool = createTool({
  id: 'create-company',
  description: 'Create a new company record.',
  inputSchema: z.object({
    title: z.string().min(1),
    context: z.string().optional(),
    is_active: z.boolean().optional().default(true),
  }),
  outputSchema: mutationOutput,
  execute: async ({ title, context, is_active }) => {
    try {
      const record = await createCompany({ title, context, is_active });
      return { success: true, record: toMutationRecord(record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Contact ─────────────────────────────────────────────────────────────────

export const createContactTool = createTool({
  id: 'create-contact',
  description:
    'Create a new contact. ' +
    'title is the display name and is auto-derived from "firstname lastname" when omitted — ' +
    'so you only need to provide firstname and/or lastname. ' +
    'contact_type, contact_profession, and company are auto-created ' +
    'if they do not yet exist — pass typeName, professionName, and/or companyName to link them.',
  inputSchema: z.object({
    title: z
      .string()
      .optional()
      .describe('Display name — auto-set to "firstname lastname" if omitted'),
    firstname: z.string().optional(),
    lastname: z.string().optional(),
    email: z.string().optional(),
    mobile: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional().default(true),
    typeName: z
      .string()
      .optional()
      .describe('Contact type title — created automatically if absent'),
    typeContext: z.string().optional(),
    professionName: z
      .string()
      .optional()
      .describe('Contact profession title — created automatically if absent'),
    professionContext: z.string().optional(),
    companyName: z.string().optional().describe('Company title — created automatically if absent'),
    companyContext: z.string().optional(),
  }),
  outputSchema: mutationOutput,
  execute: async ({
    title,
    firstname,
    lastname,
    email,
    mobile,
    context,
    is_active,
    typeName,
    typeContext,
    professionName,
    professionContext,
    companyName,
    companyContext,
  }) => {
    try {
      const resolvedTitle = title?.trim() || [firstname, lastname].filter(Boolean).join(' ').trim();
      if (!resolvedTitle) {
        return {
          success: false,
          error: 'At least one of title, firstname, or lastname is required.',
        };
      }
      const { contact } = await createContactWithDependencies(
        { title: resolvedTitle, firstname, lastname, email, mobile, context, is_active },
        { typeName, typeContext, professionName, professionContext, companyName, companyContext }
      );
      return { success: true, record: toMutationRecord(contact) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// NOT USED AT THE MOMENT: no agent registers these write tools (the Mastra agents are
// read-only). Kept for a future write gateway; see CYBERDATA-12.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { updateKnowledge } from './knowledges/knowledge.js';
import { updateKnowledgeType } from './knowledges/knowledge-type.js';
import { updateGoal } from './project-management/goals.js';
import { updateProject } from './project-management/projects.js';
import { updateTask } from './project-management/tasks.js';
import { updateContactType } from './contacts/contact-type.js';
import { updateContactProfession } from './contacts/contact-profession.js';
import { updateCompany } from './contacts/companies.js';
import { updateContact } from './contacts/contacts.js';

const recordSchema = z.object({ id: z.string(), fields: z.record(z.string(), z.unknown()) });
const mutationOutput = z.object({
  success: z.boolean(),
  record: recordSchema.optional(),
  error: z.string().optional(),
});

const recordIdField = z.string().describe('Teable record ID (e.g. recXXX)');

type GR = { id: string; fields: Record<string, unknown> };
const gr = (r: { id: string; fields: object }) => r as GR;

// ── Knowledge ──────────────────────────────────────────────────────────────

export const updateKnowledgeTool = createTool({
  id: 'update-knowledge',
  description: 'Update a knowledge record by its Teable record ID.',
  inputSchema: z.object({
    recordId: recordIdField,
    title: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional(),
    knowledge_type: z.string().optional().describe('Knowledge type title'),
  }),
  outputSchema: mutationOutput,
  execute: async ({ recordId, ...fields }) => {
    try {
      const result = await updateKnowledge(recordId, fields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Knowledge Type ─────────────────────────────────────────────────────────

export const updateKnowledgeTypeTool = createTool({
  id: 'update-knowledge-type',
  description: 'Update a knowledge type record by its Teable record ID.',
  inputSchema: z.object({
    recordId: recordIdField,
    title: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional(),
  }),
  outputSchema: mutationOutput,
  execute: async ({ recordId, ...fields }) => {
    try {
      const result = await updateKnowledgeType(recordId, fields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Goal ───────────────────────────────────────────────────────────────────

export const updateGoalTool = createTool({
  id: 'update-goal',
  description: 'Update a goal record by its Teable record ID.',
  inputSchema: z.object({
    recordId: recordIdField,
    title: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional(),
    deadline: z.string().optional().describe('ISO 8601 date string'),
  }),
  outputSchema: mutationOutput,
  execute: async ({ recordId, ...fields }) => {
    try {
      const result = await updateGoal(recordId, fields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Project ────────────────────────────────────────────────────────────────

export const updateProjectTool = createTool({
  id: 'update-project',
  description:
    'Update a project record by its Teable record ID. ' +
    'Pass goalRecordId to reassign (move) this project to a different goal — replaces any existing goal link.',
  inputSchema: z.object({
    recordId: recordIdField,
    title: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional(),
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
      .describe('Reassign this project to a different goal (replaces existing goal link)'),
  }),
  outputSchema: mutationOutput,
  execute: async ({ recordId, goalRecordId, ...fields }) => {
    try {
      const updateFields = goalRecordId ? { ...fields, belong_goals: [goalRecordId] } : fields;
      const result = await updateProject(recordId, updateFields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Task ───────────────────────────────────────────────────────────────────

export const updateTaskTool = createTool({
  id: 'update-task',
  description:
    'Update a task record by its Teable record ID. ' +
    'Pass projectRecordId to reassign (move) this task to a different project — replaces any existing project link.',
  inputSchema: z.object({
    recordId: recordIdField,
    title: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional(),
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
    started_at: z.string().optional(),
    finished_at: z.string().optional(),
    projectRecordId: z
      .string()
      .optional()
      .describe('Reassign this task to a different project (replaces existing project link)'),
  }),
  outputSchema: mutationOutput,
  execute: async ({ recordId, projectRecordId, ...fields }) => {
    try {
      const updateFields = projectRecordId
        ? { ...fields, belong_project: [projectRecordId] }
        : fields;
      const result = await updateTask(recordId, updateFields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Contact Type ────────────────────────────────────────────────────────────

export const updateContactTypeTool = createTool({
  id: 'update-contact-type',
  description: 'Update a contact type record by its Teable record ID.',
  inputSchema: z.object({
    recordId: recordIdField,
    title: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional(),
  }),
  outputSchema: mutationOutput,
  execute: async ({ recordId, ...fields }) => {
    try {
      const result = await updateContactType(recordId, fields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Contact Profession ──────────────────────────────────────────────────────

export const updateContactProfessionTool = createTool({
  id: 'update-contact-profession',
  description: 'Update a contact profession record by its Teable record ID.',
  inputSchema: z.object({
    recordId: recordIdField,
    title: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional(),
  }),
  outputSchema: mutationOutput,
  execute: async ({ recordId, ...fields }) => {
    try {
      const result = await updateContactProfession(recordId, fields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Company ─────────────────────────────────────────────────────────────────

export const updateCompanyTool = createTool({
  id: 'update-company',
  description: 'Update a company record by its Teable record ID.',
  inputSchema: z.object({
    recordId: recordIdField,
    title: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional(),
  }),
  outputSchema: mutationOutput,
  execute: async ({ recordId, ...fields }) => {
    try {
      const result = await updateCompany(recordId, fields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ── Contact ─────────────────────────────────────────────────────────────────

export const updateContactTool = createTool({
  id: 'update-contact',
  description:
    'Update a contact record by its Teable record ID. ' +
    'Pass typeRecordId, professionRecordId, or companyRecordId to reassign the linked records.',
  inputSchema: z.object({
    recordId: recordIdField,
    title: z.string().optional(),
    firstname: z.string().optional(),
    lastname: z.string().optional(),
    email: z.string().optional(),
    mobile: z.string().optional(),
    context: z.string().optional(),
    is_active: z.boolean().optional(),
    typeRecordId: z
      .string()
      .optional()
      .describe('Teable record ID of the contact_type to link (replaces existing)'),
    professionRecordId: z
      .string()
      .optional()
      .describe('Teable record ID of the contact_profession to link (replaces existing)'),
    companyRecordId: z
      .string()
      .optional()
      .describe('Teable record ID of the company to link (replaces existing)'),
  }),
  outputSchema: mutationOutput,
  execute: async ({ recordId, typeRecordId, professionRecordId, companyRecordId, ...fields }) => {
    try {
      const updateFields = {
        ...fields,
        ...(typeRecordId ? { contact_type: [{ id: typeRecordId }] } : {}),
        ...(professionRecordId ? { contact_profession: [{ id: professionRecordId }] } : {}),
        ...(companyRecordId ? { contact_company: [{ id: companyRecordId }] } : {}),
      };
      const result = await updateContact(recordId, updateFields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

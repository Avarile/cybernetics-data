// NOT USED AT THE MOMENT: no agent registers these write tools (the Mastra agents are
// read-only). Kept for a future write gateway; see CYBERDATA-12.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { deleteKnowledge } from './knowledges/knowledge.js';
import { deleteKnowledgeType } from './knowledges/knowledge-type.js';
import { deleteGoal } from './project-management/goals.js';
import { deleteProject } from './project-management/projects.js';
import { deleteTask } from './project-management/tasks.js';
import { deleteContactType } from './contacts/contact-type.js';
import { deleteContactProfession } from './contacts/contact-profession.js';
import { deleteCompany } from './contacts/companies.js';
import { deleteContact } from './contacts/contacts.js';

const deleteOutput = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

const recordIdInput = z.object({
  recordId: z.string().describe('Teable record ID (e.g. recXXX)'),
});

export const deleteKnowledgeTool = createTool({
  id: 'delete-knowledge',
  description: 'Permanently delete a knowledge record by its Teable record ID.',
  inputSchema: recordIdInput,
  outputSchema: deleteOutput,
  execute: async ({ recordId }) => {
    try {
      await deleteKnowledge(recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const deleteKnowledgeTypeTool = createTool({
  id: 'delete-knowledge-type',
  description: 'Permanently delete a knowledge type record by its Teable record ID.',
  inputSchema: recordIdInput,
  outputSchema: deleteOutput,
  execute: async ({ recordId }) => {
    try {
      await deleteKnowledgeType(recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const deleteGoalTool = createTool({
  id: 'delete-goal',
  description: 'Permanently delete a goal record by its Teable record ID.',
  inputSchema: recordIdInput,
  outputSchema: deleteOutput,
  execute: async ({ recordId }) => {
    try {
      await deleteGoal(recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const deleteProjectTool = createTool({
  id: 'delete-project',
  description: 'Permanently delete a project record by its Teable record ID.',
  inputSchema: recordIdInput,
  outputSchema: deleteOutput,
  execute: async ({ recordId }) => {
    try {
      await deleteProject(recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const deleteTaskTool = createTool({
  id: 'delete-task',
  description: 'Permanently delete a task record by its Teable record ID.',
  inputSchema: recordIdInput,
  outputSchema: deleteOutput,
  execute: async ({ recordId }) => {
    try {
      await deleteTask(recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const deleteContactTypeTool = createTool({
  id: 'delete-contact-type',
  description: 'Permanently delete a contact type record by its Teable record ID.',
  inputSchema: recordIdInput,
  outputSchema: deleteOutput,
  execute: async ({ recordId }) => {
    try {
      await deleteContactType(recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const deleteContactProfessionTool = createTool({
  id: 'delete-contact-profession',
  description: 'Permanently delete a contact profession record by its Teable record ID.',
  inputSchema: recordIdInput,
  outputSchema: deleteOutput,
  execute: async ({ recordId }) => {
    try {
      await deleteContactProfession(recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const deleteCompanyTool = createTool({
  id: 'delete-company',
  description: 'Permanently delete a company record by its Teable record ID.',
  inputSchema: recordIdInput,
  outputSchema: deleteOutput,
  execute: async ({ recordId }) => {
    try {
      await deleteCompany(recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const deleteContactTool = createTool({
  id: 'delete-contact',
  description: 'Permanently delete a contact record by its Teable record ID.',
  inputSchema: recordIdInput,
  outputSchema: deleteOutput,
  execute: async ({ recordId }) => {
    try {
      await deleteContact(recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

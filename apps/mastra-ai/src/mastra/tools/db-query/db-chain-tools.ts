import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { aiDataClient } from './ai-data-client.js';
import type { AiDataClient, AiDataRecord } from './ai-data-client.js';
import { TABLES, followLink, getById, listRecords } from './ai-data-reads.js';

/** A project with its linked tasks, read as the chatting user. */
async function withTasks(client: AiDataClient, project: AiDataRecord) {
  return { project, tasks: await followLink(client, TABLES.tasks, project.fields.tasks) };
}

const recordSchema = z.object({ id: z.string(), fields: z.record(z.string(), z.unknown()) });

const projectWithTasksSchema = z.object({
  project: recordSchema,
  tasks: z.array(recordSchema),
});

// ── Get Full Hierarchy ──────────────────────────────────────────────────────

export const getFullHierarchyTool = createTool({
  id: 'get-full-hierarchy',
  description:
    'Get a goal with ALL its linked projects and ALL their linked tasks in one call (3 levels deep). ' +
    'Use this instead of chaining get-goal-with-projects + get-project-with-tasks calls.',
  inputSchema: z.object({
    goalRecordId: z.string().describe('Teable record ID of the goal (e.g. recXXX)'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    goal: recordSchema.optional(),
    projects: z.array(projectWithTasksSchema).optional(),
  }),
  execute: async ({ goalRecordId }, context) => {
    const client = aiDataClient(context);
    const goal = await getById(client, TABLES.goals, goalRecordId);
    if (!goal) return { found: false };
    const projects = await followLink(client, TABLES.projects, goal.fields.projects);
    const withAllTasks = [];
    for (const project of projects) withAllTasks.push(await withTasks(client, project));
    return { found: true, goal, projects: withAllTasks };
  },
});

// ── Get All Projects With Tasks ─────────────────────────────────────────────

export const getAllProjectsWithTasksTool = createTool({
  id: 'get-all-projects-with-tasks',
  description:
    'List all active projects (up to 50) with their linked tasks resolved. ' +
    'Useful for a full dashboard view across all goals.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    projects: z.array(projectWithTasksSchema),
    total: z.number(),
  }),
  execute: async (_input, context) => {
    const client = aiDataClient(context);
    const projects = await listRecords(client, TABLES.projects, { take: 50 });
    const withAllTasks = [];
    for (const project of projects) withAllTasks.push(await withTasks(client, project));
    return { projects: withAllTasks, total: withAllTasks.length };
  },
});

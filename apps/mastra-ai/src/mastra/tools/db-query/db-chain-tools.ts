import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createGoal } from './project-management/goals.js';
import {
  createProjectUnderGoal,
  createTaskUnderProject,
} from './project-management/project-service.js';
import { aiDataClient } from './ai-data-client.js';
import type { AiDataClient, AiDataRecord } from './ai-data-client.js';
import { TABLES, followLink, getById, listRecords } from './ai-data-reads.js';

/** A project with its linked tasks, read as the chatting user. */
async function withTasks(client: AiDataClient, project: AiDataRecord) {
  return { project, tasks: await followLink(client, TABLES.tasks, project.fields.tasks) };
}

const recordSchema = z.object({ id: z.string(), fields: z.record(z.string(), z.unknown()) });

type GenericRecord = { id: string; fields: Record<string, unknown> };
function toRecord(r: { id: string; fields: object }): GenericRecord {
  return r as GenericRecord;
}

const taskInputSchema = z.object({
  title: z.string().min(1),
  context: z.string().optional(),
  priority: z.enum(['urgent', 'important', 'prioritise', 'normal', 'can wait']).optional(),
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
});

const projectInputSchema = z.object({
  title: z.string().min(1),
  context: z.string().optional(),
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
  tasks: z.array(taskInputSchema).optional().default([]),
});

const taskResultSchema = z.object({
  title: z.string(),
  record: recordSchema.optional(),
  error: z.string().optional(),
});

const projectResultSchema = z.object({
  title: z.string(),
  record: recordSchema.optional(),
  tasks: z.array(taskResultSchema),
  error: z.string().optional(),
});

const projectWithTasksSchema = z.object({
  project: recordSchema,
  tasks: z.array(recordSchema),
});

// ── Create Goal Tree ────────────────────────────────────────────────────────
// NOT USED AT THE MOMENT: no agent registers this write tool (the Mastra agents are
// read-only). Kept for a future write gateway; see CYBERDATA-12.

export const createGoalTreeTool = createTool({
  id: 'create-goal-tree',
  description:
    'Create a full Goal with multiple Projects, each with multiple Tasks, all linked in one call. ' +
    'Returns a partial result with errors for any items that failed — other items are preserved.',
  inputSchema: z.object({
    goal: z.object({
      title: z.string().min(1),
      context: z.string().optional(),
      deadline: z.string().optional().describe('ISO 8601 date string (e.g. 2025-12-31)'),
    }),
    projects: z.array(projectInputSchema).min(1),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    goal: recordSchema.optional(),
    projects: z.array(projectResultSchema),
    errors: z.array(z.string()).optional(),
  }),
  execute: async ({ goal: goalInput, projects: projectsInput }) => {
    const errors: string[] = [];

    let goal: Awaited<ReturnType<typeof createGoal>>;
    try {
      goal = await createGoal(goalInput);
    } catch (err) {
      return {
        success: false,
        projects: [],
        errors: [`Failed to create goal: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    const projectResults = await Promise.all(
      projectsInput.map(async ({ tasks: taskInputs, ...projectFields }) => {
        let projectRecord: Awaited<ReturnType<typeof createProjectUnderGoal>>['project'];
        try {
          const { project } = await createProjectUnderGoal(projectFields, goal.id);
          projectRecord = project;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push(`Project "${projectFields.title}": ${errMsg}`);
          return { title: projectFields.title, tasks: [], error: errMsg };
        }

        const taskResults = await Promise.all(
          (taskInputs ?? []).map(async (taskFields) => {
            try {
              const { task } = await createTaskUnderProject(taskFields, projectRecord.id);
              return { title: taskFields.title, record: toRecord(task) };
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              errors.push(`Task "${taskFields.title}" in "${projectFields.title}": ${errMsg}`);
              return { title: taskFields.title, error: errMsg };
            }
          })
        );

        return { title: projectFields.title, record: toRecord(projectRecord), tasks: taskResults };
      })
    );

    return {
      success: errors.length === 0,
      goal: toRecord(goal),
      projects: projectResults,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
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

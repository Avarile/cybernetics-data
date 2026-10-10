import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { canWrite } from '../db-query/ai-data-client.js';

/** Refusal for tools that change data when the chatting user cannot write to the base. */
const writeDenied = (tool: string) =>
  `Permission denied: ${tool} changes data and you do not have write access to this base.`;
import {
  listIndexes,
  getIndex,
  createIndex,
  updateIndex,
  deleteIndex,
  restoreIndex,
} from '../../db/db-vector.js';

const indexSchema = z.object({
  id: z.number(),
  name: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// ─────────────────────────────────────────────
// Tool: list-indexes
// ─────────────────────────────────────────────
export const listIndexesTool = createTool({
  id: 'list-indexes',
  description:
    'List all embedding indexes registered in the system. ' +
    'Active indexes are available for vector search. ' +
    'Set includeInactive=true to also see soft-deleted indexes.',
  inputSchema: z.object({
    includeInactive: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({
    indexes: z.array(indexSchema),
    total: z.number(),
  }),
  execute: async ({ includeInactive }) => {
    const indexes = await listIndexes(includeInactive);
    return {
      indexes: indexes.map((ix) => ({
        ...ix,
        created_at: ix.created_at.toISOString(),
        updated_at: ix.updated_at.toISOString(),
      })),
      total: indexes.length,
    };
  },
});

// ─────────────────────────────────────────────
// Tool: get-index
// ─────────────────────────────────────────────
export const getIndexTool = createTool({
  id: 'get-index',
  description: 'Get details of a single embedding index by its name.',
  inputSchema: z.object({
    name: z.string().describe('The index name (slug), e.g. "finance" or "work"'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    index: indexSchema.optional(),
  }),
  execute: async ({ name }) => {
    const ix = await getIndex(name);
    if (!ix) return { found: false };
    return {
      found: true,
      index: {
        ...ix,
        created_at: ix.created_at.toISOString(),
        updated_at: ix.updated_at.toISOString(),
      },
    };
  },
});

// ─────────────────────────────────────────────
// Tool: create-index
// ─────────────────────────────────────────────
export const createIndexTool = createTool({
  id: 'create-index',
  description:
    'Register a new embedding index. The name becomes the PgVector index identifier — ' +
    'ensure the corresponding PgVector index already exists before ingesting vectors into it.',
  inputSchema: z.object({
    name: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]*$/,
        'Lowercase letters, digits, and underscores only; must start with a letter'
      )
      .describe('Unique slug used as the PgVector index name, e.g. "work" or "my_notes"'),
    label: z.string().min(1).describe('Human-readable display name, e.g. "Work Documents"'),
    description: z.string().optional().describe('What kind of content belongs in this index'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    index: indexSchema.optional(),
    error: z.string().optional(),
  }),
  execute: async ({ name, label, description }, context) => {
    if (!canWrite(context)) return { success: false, error: writeDenied('create-index') };
    try {
      const ix = await createIndex({ name, label, description });
      return {
        success: true,
        index: {
          ...ix,
          created_at: ix.created_at.toISOString(),
          updated_at: ix.updated_at.toISOString(),
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ─────────────────────────────────────────────
// Tool: update-index
// ─────────────────────────────────────────────
export const updateIndexTool = createTool({
  id: 'update-index',
  description: 'Update the label or description of an existing embedding index.',
  inputSchema: z.object({
    name: z.string().describe('The index name to update'),
    label: z.string().optional().describe('New display label'),
    description: z.string().optional().describe('New description'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    index: indexSchema.optional(),
    error: z.string().optional(),
  }),
  execute: async ({ name, label, description }, context) => {
    if (!canWrite(context)) return { success: false, error: writeDenied('update-index') };
    try {
      const ix = await updateIndex(name, { label, description });
      if (!ix) return { success: false, error: `Index "${name}" not found` };
      return {
        success: true,
        index: {
          ...ix,
          created_at: ix.created_at.toISOString(),
          updated_at: ix.updated_at.toISOString(),
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

// ─────────────────────────────────────────────
// Tool: delete-index
// ─────────────────────────────────────────────
export const deleteIndexTool = createTool({
  id: 'delete-index',
  description:
    'Soft-delete an embedding index (sets is_active=false). ' +
    'The index record and all vectors in PgVector are preserved. ' +
    'The index will no longer appear in search results. Use restore-index to undo.',
  inputSchema: z.object({
    name: z.string().describe('The index name to soft-delete'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ name }, context) => {
    if (!canWrite(context)) return { success: false, message: writeDenied('delete-index') };
    const ok = await deleteIndex(name);
    return {
      success: ok,
      message: ok ? `Index "${name}" deactivated` : `Index "${name}" not found or already inactive`,
    };
  },
});

// ─────────────────────────────────────────────
// Tool: restore-index
// ─────────────────────────────────────────────
export const restoreIndexTool = createTool({
  id: 'restore-index',
  description: 'Re-activate a soft-deleted embedding index.',
  inputSchema: z.object({
    name: z.string().describe('The index name to restore'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ name }, context) => {
    if (!canWrite(context)) return { success: false, message: writeDenied('restore-index') };
    const ok = await restoreIndex(name);
    return {
      success: ok,
      message: ok ? `Index "${name}" restored` : `Index "${name}" not found or already active`,
    };
  },
});

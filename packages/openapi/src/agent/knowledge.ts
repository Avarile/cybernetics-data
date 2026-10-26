import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

/** Knowledge administration (design §14.3): the one-off import of the old Mastra vectors. */
export const AGENT_IMPORT_LEGACY_KNOWLEDGE = '/agent/admin/knowledge/import-legacy';

export const importLegacyKnowledgeRoSchema = z.object({
  /** Report what would be imported without writing anything. */
  dryRun: z.boolean().optional(),
});
export type IImportLegacyKnowledgeRo = z.infer<typeof importLegacyKnowledgeRoSchema>;

export const legacyIndexReportSchema = z.object({
  index: z.string(),
  label: z.string().nullable(),
  collection: z.string().nullable(),
  documents: z.number(),
  chunks: z.number(),
  outcome: z.enum(['imported', 'would_import', 'empty', 'skipped_secret', 'invalid_name']),
  note: z.string().nullable(),
});

export const importLegacyKnowledgeVoSchema = z.object({
  dryRun: z.boolean(),
  /** False when the vector database has no Mastra registry or vectors. */
  found: z.boolean(),
  indexes: z.array(legacyIndexReportSchema),
  /** Documents queued for ingest (0 in a dry run). */
  queued: z.number(),
});
export type IImportLegacyKnowledgeVo = z.infer<typeof importLegacyKnowledgeVoSchema>;

export const AgentImportLegacyKnowledgeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_IMPORT_LEGACY_KNOWLEDGE,
  description:
    'Import the old Mastra vector indexes into knowledge collections (re-chunked and re-embedded)',
  request: {
    body: { content: { 'application/json': { schema: importLegacyKnowledgeRoSchema } } },
  },
  responses: {
    200: {
      description: 'What was (or would be) imported, per index',
      content: { 'application/json': { schema: importLegacyKnowledgeVoSchema } },
    },
  },
  tags: ['agent'],
});

export const importLegacyKnowledge = async (ro: IImportLegacyKnowledgeRo) =>
  (await axios.post<IImportLegacyKnowledgeVo>(AGENT_IMPORT_LEGACY_KNOWLEDGE, ro)).data;

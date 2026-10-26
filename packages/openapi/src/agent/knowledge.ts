import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

/** Knowledge administration (design §11.3): reindex the knowledge tables. */
export const AGENT_SYNC_KNOWLEDGE = '/agent/admin/knowledge/sync';

export const syncKnowledgeVoSchema = z.object({
  tables: z.number(),
  records: z.number(),
  indexed: z.number(),
  unchanged: z.number(),
  removed: z.number(),
  failed: z.number(),
  errors: z.array(z.string()),
});
export type ISyncKnowledgeVo = z.infer<typeof syncKnowledgeVoSchema>;

export const AgentSyncKnowledgeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_SYNC_KNOWLEDGE,
  description:
    'Index every record of the knowledge tables and agent memory now (unchanged records are skipped)',
  responses: {
    200: {
      description: 'What the sync did',
      content: { 'application/json': { schema: syncKnowledgeVoSchema } },
    },
  },
  tags: ['agent'],
});

export const syncKnowledge = async () =>
  (await axios.post<ISyncKnowledgeVo>(AGENT_SYNC_KNOWLEDGE)).data;

import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

/** Design §12: the caller's own threads. Everything else lives in the Agent base tables. */
export const agentThreadVoSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['active', 'archived']).nullable(),
  messageCount: z.number().nullable(),
  lastMessageAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  /** From the admin's model prices; null when the model is not priced. */
  costUsd: z.number().nullable(),
  /** A run that is still going or waiting for approval. */
  activeRun: z
    .object({ id: z.string(), status: z.enum(['running', 'awaiting_approval']) })
    .nullable(),
});
export type IAgentThreadVo = z.infer<typeof agentThreadVoSchema>;

export const agentThreadListVoSchema = z.object({
  threads: z.array(agentThreadVoSchema),
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type IAgentThreadListVo = z.infer<typeof agentThreadListVoSchema>;

export const agentThreadListQuerySchema = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  status: z.enum(['active', 'archived']).optional(),
});
export type IAgentThreadListQuery = z.infer<typeof agentThreadListQuerySchema>;

export const updateAgentThreadRoSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict();
export type IUpdateAgentThreadRo = z.infer<typeof updateAgentThreadRoSchema>;

/** A stored message as AI SDK `UIMessage` (id, role, parts) plus bookkeeping. */
export const agentMessageVoSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(z.record(z.string(), z.unknown())),
  seq: z.number(),
  model: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type IAgentMessageVo = z.infer<typeof agentMessageVoSchema>;

export const agentMessageListVoSchema = z.object({ messages: z.array(agentMessageVoSchema) });
export type IAgentMessageListVo = z.infer<typeof agentMessageListVoSchema>;

export const AGENT_THREADS = '/agent/threads';
export const AGENT_THREAD = '/agent/threads/{threadId}';
export const AGENT_THREAD_MESSAGES = '/agent/threads/{threadId}/messages';

const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { 'application/json': { schema } },
});
const params = z.object({ threadId: z.string() });
const tags = ['agent'];

export const AgentThreadListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_THREADS,
  description: "The caller's threads, newest first",
  request: { query: agentThreadListQuerySchema },
  responses: { 200: { description: 'Threads', ...json(agentThreadListVoSchema) } },
  tags,
});

export const AgentThreadGetRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_THREAD,
  description: 'One of the caller’s threads',
  request: { params },
  responses: { 200: { description: 'Thread', ...json(agentThreadVoSchema) } },
  tags,
});

export const AgentThreadUpdateRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: AGENT_THREAD,
  description: 'Rename or archive a thread',
  request: { params, body: json(updateAgentThreadRoSchema) },
  responses: { 200: { description: 'Thread', ...json(agentThreadVoSchema) } },
  tags,
});

export const AgentThreadDeleteRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: AGENT_THREAD,
  description: 'Delete a thread and its messages (they go to the trash)',
  request: { params },
  responses: { 200: { description: 'Deleted' } },
  tags,
});

export const AgentThreadMessagesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_THREAD_MESSAGES,
  description: 'The messages of a thread, oldest first',
  request: { params },
  responses: { 200: { description: 'Messages', ...json(agentMessageListVoSchema) } },
  tags,
});

export const listAgentThreads = async (query?: IAgentThreadListQuery) =>
  (await axios.get<IAgentThreadListVo>(AGENT_THREADS, { params: query })).data;

export const getAgentThread = async (threadId: string) =>
  (await axios.get<IAgentThreadVo>(urlBuilder(AGENT_THREAD, { threadId }))).data;

export const updateAgentThread = async (threadId: string, ro: IUpdateAgentThreadRo) =>
  (await axios.patch<IAgentThreadVo>(urlBuilder(AGENT_THREAD, { threadId }), ro)).data;

export const deleteAgentThread = async (threadId: string) =>
  (await axios.delete(urlBuilder(AGENT_THREAD, { threadId }))).data;

export const getAgentThreadMessages = async (threadId: string) =>
  (await axios.get<IAgentMessageListVo>(urlBuilder(AGENT_THREAD_MESSAGES, { threadId }))).data;

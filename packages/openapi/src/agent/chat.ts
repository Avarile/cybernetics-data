import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

/** Design §10.1, §12: one turn, streamed as an AI SDK UI message stream (SSE). */
export const agentChatContextSchema = z
  .object({
    baseId: z.string().optional(),
    tableId: z.string().optional(),
    viewId: z.string().optional(),
    recordIds: z.array(z.string()).max(100).optional(),
    /** Voice design §7.3: the admin talks by voice and hears the reply; answers stay short. */
    voice: z.boolean().optional(),
  })
  .strict();
export type IAgentChatContext = z.infer<typeof agentChatContextSchema>;

export const agentApprovalSchema = z
  .object({
    approvalId: z.string().min(1),
    approved: z.boolean(),
    reason: z.string().max(1000).optional(),
  })
  .strict();
export type IAgentApproval = z.infer<typeof agentApprovalSchema>;

/**
 * Either a new message (a new turn) or the admin's answers to pending approvals (the turn
 * continues). Without `threadId` a new thread is started.
 */
export const agentChatRoSchema = z
  .object({
    threadId: z.string().startsWith('rec').optional(),
    message: z
      .object({ text: z.string().min(1).max(100_000) })
      .strict()
      .optional(),
    approvals: z.array(agentApprovalSchema).min(1).max(50).optional(),
    context: agentChatContextSchema.optional(),
  })
  .strict()
  .refine((ro) => Boolean(ro.message) !== Boolean(ro.approvals), {
    message: 'Send either a message or approvals',
  })
  .refine((ro) => !ro.approvals || ro.threadId, {
    message: 'Approvals need the threadId of the run that asked for them',
  });
export type IAgentChatRo = z.infer<typeof agentChatRoSchema>;

/** The first data part of every stream: which thread and run this is. */
export const agentRunDataSchema = z.object({ threadId: z.string(), runId: z.string() });
export type IAgentRunData = z.infer<typeof agentRunDataSchema>;

export const agentRunVoSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  status: z.enum(['running', 'awaiting_approval', 'done', 'failed', 'cancelled']),
});
export type IAgentRunVo = z.infer<typeof agentRunVoSchema>;

export const AGENT_CHAT = '/agent/chat';
export const AGENT_RUN_CANCEL = '/agent/runs/{runId}/cancel';

export const AgentChatRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_CHAT,
  description:
    'Start or continue a turn; the response is an AI SDK UI message stream (server-sent events)',
  request: { body: { content: { 'application/json': { schema: agentChatRoSchema } } } },
  responses: { 200: { description: 'text/event-stream of UI message chunks' } },
  tags: ['agent'],
});

export const AgentRunCancelRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_RUN_CANCEL,
  description: 'Stop a running turn',
  request: { params: z.object({ runId: z.string() }) },
  responses: {
    200: {
      description: 'The run after cancelling',
      content: { 'application/json': { schema: agentRunVoSchema } },
    },
  },
  tags: ['agent'],
});

export const cancelAgentRun = async (runId: string) =>
  (await axios.post<IAgentRunVo>(urlBuilder(AGENT_RUN_CANCEL, { runId }))).data;

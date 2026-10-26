import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

/** Design §7.1, §7.4, §12: the agent's home and whether it can run. Instance admins only. */
export const agentInstallationStatusSchema = z.enum([
  'needs_setup',
  'ok',
  'repairing',
  'error',
  'disabled',
]);
export type IAgentInstallationStatus = z.infer<typeof agentInstallationStatusSchema>;

/** The model slots of the default `agent_setup` row. */
export const agentModelSlotSchema = z.enum(['model', 'small_model']);
export type IAgentModelSlot = z.infer<typeof agentModelSlotSchema>;

export const agentModelStatusSchema = z.object({
  slot: agentModelSlotSchema,
  /** `providerId/model`, or null when the slot is empty. */
  ref: z.string().nullable(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type IAgentModelStatus = z.infer<typeof agentModelStatusSchema>;

export const agentWarningCodeSchema = z.enum([
  'not_enabled',
  'installation',
  'no_chat_model',
  'model_unavailable',
  'secrets_key_missing',
  'field_type_changed',
]);
export type IAgentWarningCode = z.infer<typeof agentWarningCodeSchema>;

export const agentWarningSchema = z.object({
  code: agentWarningCodeSchema,
  message: z.string(),
});
export type IAgentWarning = z.infer<typeof agentWarningSchema>;

export const agentStatusVoSchema = z.object({
  enabled: z.boolean(),
  status: agentInstallationStatusSchema,
  spaceId: z.string().nullable(),
  baseId: z.string().nullable(),
  /** pack table key -> table id */
  tables: z.record(z.string(), z.string()),
  lastVerifiedTime: z.string().nullable(),
  lastError: z.string().nullable(),
  /** The last check: membership changes, repairs, revoked shares, renamed or retyped columns. */
  health: z.record(z.string(), z.unknown()).nullable(),
  models: z.array(agentModelStatusSchema),
  warnings: z.array(agentWarningSchema),
});
export type IAgentStatusVo = z.infer<typeof agentStatusVoSchema>;

/** Reset starts over with a new, empty Agent base; the old one is kept. */
export const resetAgentRoSchema = z.object({ confirm: z.literal(true) }).strict();
export type IResetAgentRo = z.infer<typeof resetAgentRoSchema>;

export const AGENT_STATUS = '/agent/status';
export const AGENT_ENABLE = '/agent/admin/enable';
export const AGENT_DISABLE = '/agent/admin/disable';
export const AGENT_VERIFY = '/agent/admin/verify';
export const AGENT_RESET = '/agent/admin/reset';

const statusResponse = (description: string) => ({
  200: { description, content: { 'application/json': { schema: agentStatusVoSchema } } },
});
const tags = ['agent'];

export const AgentStatusRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_STATUS,
  description: 'Whether the agent is enabled and can run: installation health, models, warnings',
  responses: statusResponse('Agent status'),
  tags,
});

export const AgentEnableRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_ENABLE,
  description: 'Enable the agent; the first time, creates the Agent space and base',
  responses: statusResponse('Agent status after enabling'),
  tags,
});

export const AgentDisableRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_DISABLE,
  description: 'Disable the agent; the Agent space and its data are kept',
  responses: statusResponse('Agent status after disabling'),
  tags,
});

export const AgentVerifyRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_VERIFY,
  description: 'Check and repair the Agent space now',
  responses: statusResponse('Agent status after the check'),
  tags,
});

export const AgentResetRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_RESET,
  description: 'Start over with a new, empty Agent base (the old base is kept)',
  request: {
    body: { content: { 'application/json': { schema: resetAgentRoSchema } } },
  },
  responses: statusResponse('Agent status after the reset'),
  tags,
});

export const getAgentStatus = async () => (await axios.get<IAgentStatusVo>(AGENT_STATUS)).data;

export const enableAgent = async () => (await axios.post<IAgentStatusVo>(AGENT_ENABLE)).data;

export const disableAgent = async () => (await axios.post<IAgentStatusVo>(AGENT_DISABLE)).data;

export const verifyAgent = async () => (await axios.post<IAgentStatusVo>(AGENT_VERIFY)).data;

export const resetAgent = async (ro: IResetAgentRo) =>
  (await axios.post<IAgentStatusVo>(AGENT_RESET, ro)).data;

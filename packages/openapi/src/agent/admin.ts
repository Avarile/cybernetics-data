import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { agentStatusVoSchema, type IAgentStatusVo } from './lifecycle';

/** Admin ▸ Agent (design §13): the default setup, credentials, audit, restore. */
export const AGENT_TOOLKIT_IDS = [
  'memory',
  'skills',
  'threads',
  'setup',
  'credentials',
  'data_read',
  'data_write',
  'schema',
  'sql_read',
  'knowledge',
  'http',
] as const;

export const AGENT_APPROVAL_CATEGORIES = [
  'delete_records',
  'bulk_write',
  'schema_change',
  'delete_schema',
  'http_write',
  'setup_change',
  'skill_change',
] as const;

/** `providerId/model`, as the model slots store them. */
export const agentModelRefSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*\/\S+$/, 'use providerId/model, e.g. openai/gpt-4.1');

export const agentSetupVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  persona: z.string().nullable(),
  model: z.string().nullable(),
  smallModel: z.string().nullable(),
  embeddingModel: z.string().nullable(),
  rerankModel: z.string().nullable(),
  temperature: z.number().nullable(),
  maxSteps: z.number().nullable(),
  maxOutputTokens: z.number().nullable(),
  contextBudgetTokens: z.number().nullable(),
  toolkits: z.array(z.string()),
  approvalRequired: z.array(z.string()),
  memoryMode: z.enum(['off', 'explicit', 'auto']).nullable(),
});
export type IAgentSetupVo = z.infer<typeof agentSetupVoSchema>;

export const updateAgentSetupRoSchema = z
  .object({
    persona: z.string().max(20_000).nullable(),
    model: agentModelRefSchema.nullable(),
    smallModel: agentModelRefSchema.nullable(),
    embeddingModel: agentModelRefSchema.nullable(),
    rerankModel: agentModelRefSchema.nullable(),
    temperature: z.number().min(0).max(2).nullable(),
    maxSteps: z.number().int().min(1).max(100),
    maxOutputTokens: z.number().int().min(256).max(128_000),
    contextBudgetTokens: z.number().int().min(2_000).max(2_000_000).nullable(),
    toolkits: z.array(z.enum(AGENT_TOOLKIT_IDS)),
    approvalRequired: z.array(z.enum(AGENT_APPROVAL_CATEGORIES)),
    memoryMode: z.enum(['off', 'explicit', 'auto']),
  })
  .partial()
  .strict();
export type IUpdateAgentSetupRo = z.infer<typeof updateAgentSetupRoSchema>;

/** Metadata only: no API ever returns a secret value. */
export const agentCredentialVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  authKind: z.string().nullable(),
  allowedHosts: z.array(z.string()),
  allowedMethods: z.array(z.string()),
  status: z.enum(['missing', 'set', 'invalid', 'expired']).nullable(),
  preview: z.string().nullable(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export type IAgentCredentialVo = z.infer<typeof agentCredentialVoSchema>;

export const agentCredentialListVoSchema = z.object({
  credentials: z.array(agentCredentialVoSchema),
});
export type IAgentCredentialListVo = z.infer<typeof agentCredentialListVoSchema>;

/** The only way a secret gets in (design D4); it is never returned. */
export const setAgentSecretRoSchema = z
  .object({
    value: z.string().min(1).max(10_000),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export type ISetAgentSecretRo = z.infer<typeof setAgentSecretRoSchema>;

export const testAgentCredentialVoSchema = z.object({
  ok: z.boolean(),
  status: z.number().optional(),
  error: z.string().optional(),
});
export type ITestAgentCredentialVo = z.infer<typeof testAgentCredentialVoSchema>;

export const agentAuditItemSchema = z.object({
  id: z.string(),
  runId: z.string(),
  actorUserId: z.string(),
  tool: z.string(),
  /** Redacted JSON of the arguments. */
  args: z.string(),
  resultSummary: z.string().nullable(),
  status: z.string(),
  durationMs: z.number(),
  createdTime: z.string(),
});
export type IAgentAuditItem = z.infer<typeof agentAuditItemSchema>;

export const agentAuditListVoSchema = z.object({
  items: z.array(agentAuditItemSchema),
  nextCursor: z.string().nullable(),
});
export type IAgentAuditListVo = z.infer<typeof agentAuditListVoSchema>;

export const agentAuditQuerySchema = z.object({
  runId: z.string().optional(),
  cursor: z.string().optional(),
});
export type IAgentAuditQuery = z.infer<typeof agentAuditQuerySchema>;

export const AGENT_SETUP = '/agent/setup';
export const AGENT_CREDENTIALS = '/agent/credentials';
export const AGENT_AUDIT = '/agent/audit';
export const AGENT_RESTORE = '/agent/admin/restore';
export const AGENT_CREDENTIAL_SECRET = '/agent/credentials/{credentialId}/secret';
export const AGENT_CREDENTIAL_TEST = '/agent/credentials/{credentialId}/test';

const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { 'application/json': { schema } },
});
const tags = ['agent'];

export const AgentSetupGetRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_SETUP,
  description: 'The default agent setup (the active default row of agent_setup)',
  responses: { 200: { description: 'Setup', ...json(agentSetupVoSchema) } },
  tags,
});

export const AgentSetupUpdateRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: AGENT_SETUP,
  description: 'Change the default agent setup',
  request: { body: json(updateAgentSetupRoSchema) },
  responses: { 200: { description: 'Setup', ...json(agentSetupVoSchema) } },
  tags,
});

export const AgentCredentialListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_CREDENTIALS,
  description: 'Credentials the agent may use (metadata only, never the secret)',
  responses: { 200: { description: 'Credentials', ...json(agentCredentialListVoSchema) } },
  tags,
});

export const AgentAuditRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AGENT_AUDIT,
  description: 'The audit log, newest first',
  request: { query: agentAuditQuerySchema },
  responses: { 200: { description: 'Audit entries', ...json(agentAuditListVoSchema) } },
  tags,
});

export const AgentRestoreRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_RESTORE,
  description: 'Restore the Agent space and base from the trash',
  responses: { 200: { description: 'Agent status after restoring', ...json(agentStatusVoSchema) } },
  tags,
});

const credentialParams = z.object({ credentialId: z.string() });

export const AgentSecretSetRoute: RouteConfig = registerRoute({
  method: 'put',
  path: AGENT_CREDENTIAL_SECRET,
  description: 'Set the secret of a credential (stored encrypted; never returned)',
  request: { params: credentialParams, body: json(setAgentSecretRoSchema) },
  responses: { 200: { description: 'Credential metadata', ...json(agentCredentialVoSchema) } },
  tags,
});

export const AgentSecretDeleteRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: AGENT_CREDENTIAL_SECRET,
  description: 'Remove the secret of a credential',
  request: { params: credentialParams },
  responses: { 200: { description: 'Credential metadata', ...json(agentCredentialVoSchema) } },
  tags,
});

export const AgentCredentialTestRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AGENT_CREDENTIAL_TEST,
  description: 'Try the credential against its first allowed host',
  request: { params: credentialParams },
  responses: { 200: { description: 'Result', ...json(testAgentCredentialVoSchema) } },
  tags,
});

export const setAgentCredentialSecret = async (credentialId: string, ro: ISetAgentSecretRo) =>
  (await axios.put<IAgentCredentialVo>(urlBuilder(AGENT_CREDENTIAL_SECRET, { credentialId }), ro))
    .data;

export const deleteAgentCredentialSecret = async (credentialId: string) =>
  (await axios.delete<IAgentCredentialVo>(urlBuilder(AGENT_CREDENTIAL_SECRET, { credentialId })))
    .data;

export const testAgentCredential = async (credentialId: string) =>
  (await axios.post<ITestAgentCredentialVo>(urlBuilder(AGENT_CREDENTIAL_TEST, { credentialId })))
    .data;

export const getAgentSetup = async () => (await axios.get<IAgentSetupVo>(AGENT_SETUP)).data;

export const updateAgentSetup = async (ro: IUpdateAgentSetupRo) =>
  (await axios.patch<IAgentSetupVo>(AGENT_SETUP, ro)).data;

export const listAgentCredentials = async () =>
  (await axios.get<IAgentCredentialListVo>(AGENT_CREDENTIALS)).data;

export const getAgentAudit = async (query?: IAgentAuditQuery) =>
  (await axios.get<IAgentAuditListVo>(AGENT_AUDIT, { params: query })).data;

export const restoreAgent = async () => (await axios.post<IAgentStatusVo>(AGENT_RESTORE)).data;

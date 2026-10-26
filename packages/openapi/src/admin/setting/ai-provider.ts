import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import { gatewayModelTagSchema } from './gateway-model';
import { chatModelAbilitySchema } from './model-ability';
import { LLMProviderType, llmProviderSchema, providerIdSchema } from './update';

/** Where a provider's key comes from. */
export const providerKeySourceSchema = z.enum(['stored', 'env', 'none']);
export type IProviderKeySource = z.infer<typeof providerKeySourceSchema>;

/** Health computed by the backend; never derived in the browser. */
export const providerHealthStatusSchema = z.enum([
  'ready',
  'untested',
  'not-set',
  'error',
  'disabled',
]);
export type IProviderHealthStatus = z.infer<typeof providerHealthStatusSchema>;

/** Something that references a provider (blocks deleting it). */
export const providerUsageSchema = z.object({
  kind: z.enum(['chat-model', 'embedding-model', 'translation-model', 'agent-model']),
  label: z.string(),
  modelKey: z.string(),
});
export type IProviderUsage = z.infer<typeof providerUsageSchema>;

/**
 * A provider as the admin API returns it: the key is never included, only whether there is one,
 * where it comes from and a short preview.
 */
export const aiProviderVoSchema = llmProviderSchema.omit({ apiKey: true }).extend({
  id: providerIdSchema,
  hasApiKey: z.boolean(),
  keySource: providerKeySourceSchema,
  apiKeyPreview: z.string().optional(),
  envSet: z.boolean().optional(),
  status: providerHealthStatusSchema,
  lastTestedAt: z.string().optional(),
  lastError: z.string().optional(),
  modelCount: z.number().int(),
  usedBy: z.array(providerUsageSchema),
  version: z.number().int(),
  /** True for the Vercel AI Gateway entry, whose models are managed by the Gateway model pool. */
  managedModels: z.boolean().optional(),
});
export type IAiProviderVo = z.infer<typeof aiProviderVoSchema>;

export const aiProviderListVoSchema = z.object({ providers: z.array(aiProviderVoSchema) });
export type IAiProviderListVo = z.infer<typeof aiProviderListVoSchema>;

const providerWriteFields = llmProviderSchema.omit({
  isInstance: true,
  version: true,
  lastTest: true,
});

/** Create: the id is chosen once and never changes. `apiKey` is plain text and stored encrypted. */
export const createAiProviderRoSchema = providerWriteFields.extend({ id: providerIdSchema });
export type ICreateAiProviderRo = z.infer<typeof createAiProviderRoSchema>;

/**
 * Update: `version` must match. A missing field is unchanged; `null` clears `apiKey`, `apiKeyEnv`
 * and `baseUrl`.
 */
export const updateAiProviderRoSchema = providerWriteFields
  .omit({ id: true, apiKey: true, apiKeyEnv: true, baseUrl: true })
  .partial()
  .extend({
    version: z.number().int().min(0),
    apiKey: z.string().min(1).nullable().optional(),
    apiKeyEnv: providerWriteFields.shape.apiKeyEnv.unwrap().nullable().optional(),
    baseUrl: z.string().url().nullable().optional(),
  });
export type IUpdateAiProviderRo = z.infer<typeof updateAiProviderRoSchema>;

/** Test a saved provider (`providerId`, optionally with unsaved overrides) or a draft. */
export const testAiProviderRoSchema = z.object({
  providerId: providerIdSchema.optional(),
  draft: providerWriteFields
    .omit({ id: true, name: true, models: true })
    .extend({ models: z.string().optional() })
    .partial({ type: true })
    .optional(),
  model: z.string().optional(),
});
export type ITestAiProviderRo = z.infer<typeof testAiProviderRoSchema>;

export const testAiProviderVoSchema = z.object({
  ok: z.boolean(),
  status: z.number().int().optional(),
  latencyMs: z.number().int(),
  models: z.array(z.string()).optional(),
  error: z.string().optional(),
  hint: z.string().optional(),
});
export type ITestAiProviderVo = z.infer<typeof testAiProviderVoSchema>;

export const aiProviderModelsVoSchema = z.object({
  models: z.array(z.string()),
  fetched: z.boolean(),
  error: z.string().optional(),
});
export type IAiProviderModelsVo = z.infer<typeof aiProviderModelsVoSchema>;

export const testAiProviderModelsRoSchema = z.object({
  models: z.array(z.string().min(1)).min(1).max(50),
});
export type ITestAiProviderModelsRo = z.infer<typeof testAiProviderModelsRoSchema>;

export const testAiProviderModelsVoSchema = z.object({
  results: z.array(
    z.object({
      model: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
      ability: chatModelAbilitySchema.optional(),
      tags: z.array(gatewayModelTagSchema),
    })
  ),
});
export type ITestAiProviderModelsVo = z.infer<typeof testAiProviderModelsVoSchema>;

export const aiEnvStatusVoSchema = z.object({ allowed: z.boolean(), set: z.boolean() });
export type IAiEnvStatusVo = z.infer<typeof aiEnvStatusVoSchema>;

export const AI_PROVIDERS = '/admin/ai/providers';
export const AI_PROVIDER = '/admin/ai/providers/{providerId}';
export const AI_PROVIDER_TEST = '/admin/ai/providers/test';
export const AI_PROVIDER_MODELS = '/admin/ai/providers/{providerId}/models';
export const AI_PROVIDER_MODELS_TEST = '/admin/ai/providers/{providerId}/models/test';
export const AI_ENV_STATUS = '/admin/ai/env-status';

const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { 'application/json': { schema } },
});
const providerIdParams = z.object({ providerId: providerIdSchema });
const tags = ['admin', 'ai-provider'];

export const AiProviderListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AI_PROVIDERS,
  description: 'List LLM providers (keys masked) with health and usage',
  responses: { 200: { description: 'Providers', ...json(aiProviderListVoSchema) } },
  tags,
});

export const AiProviderCreateRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AI_PROVIDERS,
  description: 'Create an LLM provider',
  request: { body: json(createAiProviderRoSchema) },
  responses: { 201: { description: 'Created provider', ...json(aiProviderVoSchema) } },
  tags,
});

export const AiProviderUpdateRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: AI_PROVIDER,
  description: 'Update an LLM provider (409 when version is stale)',
  request: { params: providerIdParams, body: json(updateAiProviderRoSchema) },
  responses: { 200: { description: 'Updated provider', ...json(aiProviderVoSchema) } },
  tags,
});

export const AiProviderDeleteRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: AI_PROVIDER,
  description: 'Delete an LLM provider (409 while it is in use)',
  request: { params: providerIdParams },
  responses: { 200: { description: 'Deleted' } },
  tags,
});

export const AiProviderTestRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AI_PROVIDER_TEST,
  description: 'Test a saved or draft LLM provider connection',
  request: { body: json(testAiProviderRoSchema) },
  responses: { 200: { description: 'Test result', ...json(testAiProviderVoSchema) } },
  tags,
});

export const AiProviderModelsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AI_PROVIDER_MODELS,
  description: "List the provider's models live from {baseUrl}/models",
  request: { params: providerIdParams },
  responses: { 200: { description: 'Models', ...json(aiProviderModelsVoSchema) } },
  tags,
});

export const AiProviderModelsTestRoute: RouteConfig = registerRoute({
  method: 'post',
  path: AI_PROVIDER_MODELS_TEST,
  description: 'Test models of a provider and record their abilities',
  request: { params: providerIdParams, body: json(testAiProviderModelsRoSchema) },
  responses: { 200: { description: 'Results', ...json(testAiProviderModelsVoSchema) } },
  tags,
});

export const AiEnvStatusRoute: RouteConfig = registerRoute({
  method: 'get',
  path: AI_ENV_STATUS,
  description: 'Whether an env var may hold a provider key and whether it is set (never the value)',
  request: { query: z.object({ name: z.string() }) },
  responses: { 200: { description: 'Env status', ...json(aiEnvStatusVoSchema) } },
  tags,
});

export const listAiProviders = async () => (await axios.get<IAiProviderListVo>(AI_PROVIDERS)).data;

export const createAiProvider = async (ro: ICreateAiProviderRo) =>
  (await axios.post<IAiProviderVo>(AI_PROVIDERS, ro)).data;

export const updateAiProvider = async (providerId: string, ro: IUpdateAiProviderRo) =>
  (await axios.patch<IAiProviderVo>(urlBuilder(AI_PROVIDER, { providerId }), ro)).data;

export const deleteAiProvider = async (providerId: string) =>
  (await axios.delete(urlBuilder(AI_PROVIDER, { providerId }))).data;

export const testAiProvider = async (ro: ITestAiProviderRo) =>
  (await axios.post<ITestAiProviderVo>(AI_PROVIDER_TEST, ro)).data;

export const getAiProviderModels = async (providerId: string) =>
  (await axios.get<IAiProviderModelsVo>(urlBuilder(AI_PROVIDER_MODELS, { providerId }))).data;

export const testAiProviderModels = async (providerId: string, ro: ITestAiProviderModelsRo) =>
  (
    await axios.post<ITestAiProviderModelsVo>(
      urlBuilder(AI_PROVIDER_MODELS_TEST, { providerId }),
      ro
    )
  ).data;

export const getAiEnvStatus = async (name: string) =>
  (await axios.get<IAiEnvStatusVo>(AI_ENV_STATUS, { params: { name } })).data;

/** Types whose endpoints serve an OpenAI-style `GET /models` listing. */
export const MODEL_LISTING_TYPES: LLMProviderType[] = [
  LLMProviderType.OPENAI,
  LLMProviderType.OPENAI_COMPATIBLE,
  LLMProviderType.OPENROUTER,
  LLMProviderType.DEEPSEEK,
  LLMProviderType.XAI,
  LLMProviderType.MISTRAL,
  LLMProviderType.TOGETHERAI,
  LLMProviderType.OLLAMA,
  LLMProviderType.ANTHROPIC,
  LLMProviderType.ANTHROPIC_COMPATIBLE,
];

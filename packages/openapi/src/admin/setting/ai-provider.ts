import { z } from '../../zod';
import { llmProviderSchema, providerIdSchema } from './update';

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
});
export type IAiProviderVo = z.infer<typeof aiProviderVoSchema>;

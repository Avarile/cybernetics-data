import { z } from '../zod';

export enum EmailSourceStatus {
  Idle = 'idle',
  Syncing = 'syncing',
  Paused = 'paused',
  Error = 'error',
  Disconnected = 'disconnected',
}

export const emailFolderSchema = z.object({
  id: z.string().describe('IMAP path, Gmail label id or Microsoft Graph folder id'),
  name: z.string(),
});

export type IEmailFolder = z.infer<typeof emailFolderSchema>;

export const EMAIL_SYNC_INTERVALS = [5, 15, 30, 60] as const;

export const emailSourceConfigSchema = z.object({
  folders: z.array(emailFolderSchema).min(1).max(20),
  since: z
    .string()
    .datetime()
    .nullable()
    .describe('Import mail received after this time; null imports all'),
  maxMessages: z.number().int().min(1).max(50_000),
  includeAttachments: z.boolean(),
  maxAttachmentMb: z.number().int().min(1).max(100),
  intervalMin: z.number().int().min(5).max(1440),
});

export type IEmailSourceConfig = z.infer<typeof emailSourceConfigSchema>;

export const emailSourceVoSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  tableId: z.string(),
  integrationId: z.string(),
  provider: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(EmailSourceStatus),
  config: emailSourceConfigSchema,
  lastSyncedTime: z.string().optional(),
  lastError: z.string().optional(),
  createdBy: z.string(),
  createdTime: z.string(),
  messageCount: z.number(),
});

export type IEmailSourceVo = z.infer<typeof emailSourceVoSchema>;

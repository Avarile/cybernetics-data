import { z } from '../zod';

export enum UserIntegrationProvider {
  Slack = 'slack',
  Gmail = 'gmail',
  Outlook = 'outlook',
  Imap = 'imap',
  // Future: Discord = 'discord',
  // Future: Telegram = 'telegram',
  // Future: Teams = 'teams',
}

export const userIntegrationSlackMetadataSchema = z.object({
  userInfo: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
  teamInfo: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export type IUserIntegrationSlackMetadata = z.infer<typeof userIntegrationSlackMetadataSchema>;

export const userIntegrationEmailMetadataSchema = z.object({
  userInfo: z.object({
    email: z.string(),
    name: z.string(),
  }),
});

export type IUserIntegrationEmailMetadata = z.infer<typeof userIntegrationEmailMetadataSchema>;

export const userIntegrationGmailMetadataSchema = userIntegrationEmailMetadataSchema;

export type IUserIntegrationGmailMetadata = IUserIntegrationEmailMetadata;

export const userIntegrationOutlookMetadataSchema = userIntegrationEmailMetadataSchema;

export type IUserIntegrationOutlookMetadata = IUserIntegrationEmailMetadata;

export const userIntegrationMailServerSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  username: z.string(),
});

export type IUserIntegrationMailServer = z.infer<typeof userIntegrationMailServerSchema>;

export const userIntegrationImapMetadataSchema = userIntegrationEmailMetadataSchema.extend({
  imap: userIntegrationMailServerSchema,
  smtp: userIntegrationMailServerSchema.optional(),
});

export type IUserIntegrationImapMetadata = z.infer<typeof userIntegrationImapMetadataSchema>;

export enum UserIntegrationStatus {
  Active = 'active',
  NeedsReauth = 'needs_reauth',
  Error = 'error',
}

export const userIntegrationMetadataSchema = z.union([
  userIntegrationSlackMetadataSchema,
  // before the plain email schema, which would strip the server blocks
  userIntegrationImapMetadataSchema,
  userIntegrationGmailMetadataSchema,
  userIntegrationOutlookMetadataSchema,
]);

export type IUserIntegrationMetadata = z.infer<typeof userIntegrationMetadataSchema>;

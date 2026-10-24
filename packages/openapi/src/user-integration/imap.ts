import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const CREATE_USER_INTEGRATION_IMAP = '/user-integrations/imap';

export const TEST_USER_INTEGRATION_CONNECTION = '/user-integrations/test-connection';

const mailServerRoSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().describe('Implicit TLS. When false the server must support STARTTLS.'),
  username: z.string().min(1).max(320),
});

export const imapServerRoSchema = mailServerRoSchema.extend({
  password: z.string().min(1).max(1024),
});

export const smtpServerRoSchema = mailServerRoSchema.extend({
  password: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe('Defaults to the IMAP password when omitted'),
});

export type IImapServerRo = z.infer<typeof imapServerRoSchema>;

export type ISmtpServerRo = z.infer<typeof smtpServerRoSchema>;

export const createImapIntegrationRoSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().max(200).optional(),
  imap: imapServerRoSchema,
  smtp: smtpServerRoSchema
    .optional()
    .describe('Outgoing server. Stored and verified only; nothing sends mail yet.'),
});

export type ICreateImapIntegrationRo = z.infer<typeof createImapIntegrationRoSchema>;

export const createImapIntegrationVoSchema = z.object({
  id: z.string(),
});

export type ICreateImapIntegrationVo = z.infer<typeof createImapIntegrationVoSchema>;

export const createImapIntegrationRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_USER_INTEGRATION_IMAP,
  description:
    'Connect an IMAP mailbox (with an optional SMTP server). The connection is tested before saving; connecting the same address again updates it.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createImapIntegrationRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created or updated',
      content: {
        'application/json': {
          schema: createImapIntegrationVoSchema,
        },
      },
    },
  },
  tags: ['user-integration'],
});

export const createImapIntegration = async (ro: ICreateImapIntegrationRo) => {
  return await axios.post<ICreateImapIntegrationVo>(CREATE_USER_INTEGRATION_IMAP, ro);
};

export const testConnectionRoSchema = z
  .object({
    imap: imapServerRoSchema.optional(),
    // a test always needs the password, so smtp uses the same shape as imap here
    smtp: imapServerRoSchema.optional(),
  })
  .refine((ro) => ro.imap || ro.smtp, { message: 'imap or smtp is required' });

export type ITestConnectionRo = z.infer<typeof testConnectionRoSchema>;

const connectionResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

export const testConnectionVoSchema = z.object({
  imap: connectionResultSchema.optional(),
  smtp: connectionResultSchema.optional(),
});

export type ITestConnectionVo = z.infer<typeof testConnectionVoSchema>;

export const testConnectionRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TEST_USER_INTEGRATION_CONNECTION,
  description: 'Test IMAP and/or SMTP credentials without saving them',
  request: {
    body: {
      content: {
        'application/json': {
          schema: testConnectionRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Result per server',
      content: {
        'application/json': {
          schema: testConnectionVoSchema,
        },
      },
    },
  },
  tags: ['user-integration'],
});

export const testUserIntegrationConnection = async (ro: ITestConnectionRo) => {
  return await axios.post<ITestConnectionVo>(TEST_USER_INTEGRATION_CONNECTION, ro);
};

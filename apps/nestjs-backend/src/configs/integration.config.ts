/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const integrationConfig = registerAs('integration', () => ({
  // 32 bytes, base64. Without it the key is derived from SECRET_KEY (logged as a warning).
  encryptionKey: process.env.BACKEND_INTEGRATION_ENCRYPTION_KEY,
  // lets IMAP/SMTP hosts resolve to private addresses (self-hosted mail servers)
  allowPrivateMailHosts: process.env.EMAIL_ALLOW_PRIVATE_HOSTS === 'true',
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
  },
  outlook: {
    clientId: process.env.OUTLOOK_CLIENT_ID,
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET,
    tenant: process.env.OUTLOOK_TENANT ?? 'common',
  },
}));

export const IntegrationConfig = () => Inject(integrationConfig.KEY);

export type IIntegrationConfig = ConfigType<typeof integrationConfig>;

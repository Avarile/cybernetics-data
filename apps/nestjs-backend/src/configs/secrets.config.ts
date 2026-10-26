/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const secretsConfig = registerAs('secrets', () => ({
  // 32 bytes, base64. Master key for provider API keys and agent credentials; each use gets its
  // own derived key. Without it the key is derived from SECRET_KEY.
  encryptionKey: process.env.BACKEND_SECRETS_ENCRYPTION_KEY || undefined,
}));

export const SecretsConfig = () => Inject(secretsConfig.KEY);

export type ISecretsConfig = ConfigType<typeof secretsConfig>;

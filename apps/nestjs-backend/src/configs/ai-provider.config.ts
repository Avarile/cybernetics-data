/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';
import { DEFAULT_PROVIDER_ENV_PATTERN } from '@teable/openapi';

export const aiProviderConfig = registerAs('aiProvider', () => ({
  // Env vars a provider may read its key or header values from. The app's own secrets are always
  // refused (PROVIDER_ENV_DENYLIST), whatever this pattern allows.
  envPattern: process.env.AI_PROVIDER_ENV_PATTERN || DEFAULT_PROVIDER_ENV_PATTERN,
}));

export const AiProviderConfig = () => Inject(aiProviderConfig.KEY);

export type IAiProviderConfig = ConfigType<typeof aiProviderConfig>;

import { Injectable } from '@nestjs/common';
import type { IAIConfig, IProviderKeySource, LLMProvider } from '@teable/openapi';
import { checkProviderEnvName, parseEnvRef } from '@teable/openapi';
import { AiProviderConfig, type IAiProviderConfig } from '../../configs/ai-provider.config';
import { BaseConfig, type IBaseConfig } from '../../configs/base.config';
import { SecretsConfig, type ISecretsConfig } from '../../configs/secrets.config';
import { SecretCipher, secretPreview } from '../../utils/secret-cipher';

/** The Vercel AI Gateway key lives in aiConfig.aiGatewayApiKey; it is shown as this provider. */
export const GATEWAY_PROVIDER_ID = 'vercel-gateway';

type IProviderKeyFields = Pick<LLMProvider, 'id' | 'apiKey' | 'apiKeyEnv'>;

const providerAad = (id: string) => `llm-provider:${id}`;

/**
 * Encrypts provider API keys at rest and resolves the key a provider should be called with. Stored
 * values are `v1:` ciphertexts bound to the provider id; values that are not ciphertexts are legacy
 * or test configs (space integrations, TEST_AI_CONFIG) and are used as they are.
 */
@Injectable()
export class ProviderSecretService {
  private readonly cipher: SecretCipher;

  constructor(
    @SecretsConfig() secretsConfig: ISecretsConfig,
    @BaseConfig() baseConfig: IBaseConfig,
    @AiProviderConfig() private readonly aiProviderConfig: IAiProviderConfig
  ) {
    this.cipher = SecretCipher.fromConfig(
      secretsConfig.encryptionKey,
      baseConfig.secretKey,
      'llm-provider'
    );
  }

  encryptKey(providerId: string, plain: string): string {
    return this.cipher.encrypt(plain, providerAad(providerId));
  }

  isEncrypted(value: unknown): value is string {
    return SecretCipher.isCiphertext(value);
  }

  /** Decrypt a stored value; plain (legacy) values pass through. Undefined for empty values. */
  reveal(providerId: string | undefined, value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    if (!SecretCipher.isCiphertext(value)) return value;
    if (!providerId) throw new Error('Encrypted provider key without a provider id');
    return this.cipher.decrypt<string>(value, providerAad(providerId));
  }

  /** The key to call the provider with: stored key first, then its env var, else none. */
  resolveKey(provider: IProviderKeyFields): string | undefined {
    const stored = this.reveal(provider.id, provider.apiKey);
    if (stored) return stored;
    return provider.apiKeyEnv ? this.readEnv(provider.apiKeyEnv) : undefined;
  }

  resolveGatewayKey(aiConfig: Pick<IAIConfig, 'aiGatewayApiKey'> | undefined | null) {
    return this.reveal(GATEWAY_PROVIDER_ID, aiConfig?.aiGatewayApiKey);
  }

  /** Header values with `env:VAR` references replaced; unset or refused vars are dropped. */
  resolveHeaders(provider: Pick<LLMProvider, 'headers'>): Record<string, string> | undefined {
    if (!provider.headers) return undefined;
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(provider.headers)) {
      const env = parseEnvRef(value);
      const resolved = env === undefined ? value : this.readEnv(env);
      if (resolved) out[name] = resolved;
    }
    return Object.keys(out).length ? out : undefined;
  }

  keySource(provider: IProviderKeyFields): IProviderKeySource {
    if (provider.apiKey) return 'stored';
    if (provider.apiKeyEnv) return 'env';
    return 'none';
  }

  /** `sk-or-…9f2c` for a stored key; never the key itself. */
  preview(provider: IProviderKeyFields): string | undefined {
    try {
      const key = this.reveal(provider.id, provider.apiKey);
      return key ? secretPreview(key) : undefined;
    } catch {
      return undefined;
    }
  }

  gatewayPreview(aiConfig: Pick<IAIConfig, 'aiGatewayApiKey'> | undefined | null) {
    try {
      const key = this.resolveGatewayKey(aiConfig);
      return key ? secretPreview(key) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Whether `name` may be used as a key source, and whether it is set. Never returns the value. */
  envStatus(name: string): { allowed: boolean; set: boolean } {
    const allowed = checkProviderEnvName(name, this.aiProviderConfig.envPattern).ok;
    return { allowed, set: allowed && Boolean(process.env[name]) };
  }

  private readEnv(name: string): string | undefined {
    if (!checkProviderEnvName(name, this.aiProviderConfig.envPattern).ok) return undefined;
    return process.env[name] || undefined;
  }
}

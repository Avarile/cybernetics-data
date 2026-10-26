import { randomBytes } from 'crypto';
import { LLMProviderType, SettingKey } from '@teable/openapi';
import { ProviderMigrationService } from './provider-migration.service';
import { GATEWAY_PROVIDER_ID, ProviderSecretService } from './provider-secret.service';

describe('ProviderMigrationService', () => {
  const secrets = new ProviderSecretService(
    { encryptionKey: randomBytes(32).toString('base64') },
    { secretKey: 'unused' } as never,
    { envPattern: '.*' }
  );

  const makePrisma = (content: string | null) => {
    const store = { content };
    return {
      store,
      setting: {
        findUnique: vi.fn(async () => (store.content === null ? null : { content: store.content })),
        update: vi.fn(async ({ data }: { data: { content: string } }) => {
          store.content = data.content;
        }),
      },
    };
  };

  const legacy = JSON.stringify({
    llmProviders: [
      { type: LLMProviderType.OPENAI, name: 'teable', apiKey: 'sk-plain', models: 'gpt-4.1' },
    ],
    aiGatewayApiKey: 'gw-plain',
    chatModel: { lg: 'openai@gpt-4.1@teable' },
  });

  it('encrypts plain keys and assigns ids, once', async () => {
    const prisma = makePrisma(legacy);
    const svc = new ProviderMigrationService(prisma as never, secrets);

    expect(await svc.migrate()).toBe(true);
    const migrated = JSON.parse(prisma.store.content!);
    expect(migrated.llmProviders[0].id).toBe('openai');
    expect(migrated.llmProviders[0].apiKey).not.toContain('sk-plain');
    expect(secrets.resolveKey(migrated.llmProviders[0])).toBe('sk-plain');
    expect(secrets.resolveGatewayKey(migrated)).toBe('gw-plain');
    // model keys are not rewritten in this step
    expect(migrated.chatModel.lg).toBe('openai@gpt-4.1@teable');
    expect(prisma.setting.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: SettingKey.AI_CONFIG } })
    );

    expect(await svc.migrate()).toBe(false);
    expect(prisma.setting.update).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an aiConfig setting', async () => {
    const prisma = makePrisma(null);
    expect(await new ProviderMigrationService(prisma as never, secrets).migrate()).toBe(false);
  });

  it('never throws on boot', async () => {
    const prisma = { setting: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } };
    await expect(
      new ProviderMigrationService(prisma as never, secrets).onApplicationBootstrap()
    ).resolves.toBeUndefined();
    expect(GATEWAY_PROVIDER_ID).toBe('vercel-gateway');
  });
});

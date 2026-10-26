import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { SettingKey } from '@teable/openapi';
import type { IAIConfig } from '@teable/openapi';
import { migrateAiConfig } from './provider-config';
import { GATEWAY_PROVIDER_ID, ProviderSecretService } from './provider-secret.service';

/**
 * On boot, gives every instance provider an id and encrypts any plain API key still stored in the
 * aiConfig setting (configs saved before keys were encrypted). Idempotent: a migrated config is
 * left untouched, so several replicas booting at once write at most the same result.
 */
@Injectable()
export class ProviderMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProviderMigrationService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly providerSecretService: ProviderSecretService
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.migrate();
    } catch (error) {
      // A failed migration must not stop the app; keys stay readable as before.
      this.logger.error(`Provider key migration failed: ${(error as Error).message}`);
    }
  }

  async migrate(): Promise<boolean> {
    const row = await this.prismaService.setting.findUnique({
      where: { name: SettingKey.AI_CONFIG },
    });
    if (!row?.content) return false;

    let aiConfig: IAIConfig;
    try {
      aiConfig = JSON.parse(row.content) as IAIConfig;
    } catch {
      return false;
    }
    if (!aiConfig || typeof aiConfig !== 'object') return false;

    const result = migrateAiConfig(
      { ...aiConfig, llmProviders: aiConfig.llmProviders ?? [] },
      {
        encrypt: (id, plain) => this.providerSecretService.encryptKey(id, plain),
        isEncrypted: (v) => this.providerSecretService.isEncrypted(v),
      },
      GATEWAY_PROVIDER_ID
    );
    if (!result.changed) return false;

    await this.prismaService.setting.update({
      where: { name: SettingKey.AI_CONFIG },
      data: { content: JSON.stringify(result.aiConfig) },
    });
    this.logger.log('Migrated instance LLM providers: ids assigned, plain API keys encrypted');
    return true;
  }
}

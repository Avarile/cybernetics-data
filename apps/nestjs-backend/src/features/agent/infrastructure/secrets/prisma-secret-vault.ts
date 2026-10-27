import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { BaseConfig, type IBaseConfig } from '../../../../configs/base.config';
import { SecretsConfig, type ISecretsConfig } from '../../../../configs/secrets.config';
import { SecretCipher, secretPreview } from '../../../../utils/secret-cipher';
import { AGENT_STORE_PORT, type IAgentStorePort, type ISecretVaultPort } from '../../domain/ports';

const purpose = 'agent-credential';
const aad = (credentialId: string) => `agent-credential:${credentialId}`;

/**
 * SecretVaultPort over Prisma `agent_secret` (design D4): AES-256-GCM with its own derived key
 * and the credential record id as AAD. The preview stays here too: the credential row, which the
 * agent can read, only ever gets the status.
 */
@Injectable()
export class PrismaSecretVault implements ISecretVaultPort {
  private readonly cipher: SecretCipher;

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @SecretsConfig() secretsConfig: ISecretsConfig,
    @BaseConfig() baseConfig: IBaseConfig
  ) {
    this.cipher = SecretCipher.fromConfig(
      secretsConfig.encryptionKey,
      baseConfig.secretKey,
      purpose
    );
  }

  async set(credentialId: string, value: string, actorUserId: string, expiresAt?: string | null) {
    const ciphertext = this.cipher.encrypt({ value }, aad(credentialId));
    const preview = secretPreview(value);
    await this.prismaService.agentSecret.upsert({
      where: { credentialRecordId: credentialId },
      create: { credentialRecordId: credentialId, ciphertext, preview, createdBy: actorUserId },
      update: { ciphertext, preview },
    });
    await this.store.updateCredential(credentialId, {
      status: 'set',
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
  }

  async delete(credentialId: string) {
    await this.prismaService.agentSecret.deleteMany({
      where: { credentialRecordId: credentialId },
    });
    await this.store.updateCredential(credentialId, { status: 'missing' });
  }

  async has(credentialId: string) {
    return (
      (await this.prismaService.agentSecret.count({
        where: { credentialRecordId: credentialId },
      })) > 0
    );
  }

  async previews(credentialIds: string[]) {
    const rows = await this.prismaService.agentSecret.findMany({
      where: { credentialRecordId: { in: credentialIds } },
      select: { credentialRecordId: true, preview: true },
    });
    return new Map(rows.map((r) => [r.credentialRecordId, r.preview]));
  }

  async reveal(credentialId: string) {
    const row = await this.prismaService.agentSecret.findUnique({
      where: { credentialRecordId: credentialId },
    });
    if (!row) return undefined;
    const { value } = this.cipher.decrypt<{ value: string }>(row.ciphertext, aad(credentialId));
    await this.prismaService.agentSecret.update({
      where: { id: row.id },
      data: { lastUsedTime: new Date() },
    });
    return value;
  }
}

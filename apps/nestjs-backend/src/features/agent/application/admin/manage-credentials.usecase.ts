import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type {
  IAgentCredentialVo,
  ISetAgentSecretRo,
  ITestAgentCredentialVo,
} from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import {
  AGENT_STORE_PORT,
  AUDIT_PORT,
  HTTP_PORT,
  SECRET_VAULT_PORT,
  type IAgentStorePort,
  type IAuditPort,
  type IHttpPort,
  type ISecretVaultPort,
} from '../../domain/ports';
import { AgentExecutionContext } from '../../infrastructure/execution-context';
import { toCredentialVo } from './configure-agent.usecase';

/**
 * Admin ▸ Agent ▸ Credentials (design §8, D4): the only way a secret gets in. The value goes
 * straight to the vault; responses carry the preview only.
 */
@Injectable()
export class ManageCredentials {
  constructor(
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(SECRET_VAULT_PORT) private readonly vault: ISecretVaultPort,
    @Inject(HTTP_PORT) private readonly http: IHttpPort,
    @Inject(AUDIT_PORT) private readonly audit: IAuditPort,
    private readonly execution: AgentExecutionContext
  ) {}

  private async credential(id: string) {
    const all = await this.store.listCredentials();
    const found = all.find((c) => c.id === id);
    if (!found) throw new CustomHttpException('Credential not found', HttpErrorCode.NOT_FOUND);
    return found;
  }

  private async view(id: string): Promise<IAgentCredentialVo> {
    const c = await this.credential(id);
    return toCredentialVo(c, (await this.vault.previews([id])).get(id) ?? null);
  }

  private log(actorUserId: string, tool: string, name: string, summary: string) {
    return this.audit.append({
      runId: 'admin',
      actorUserId,
      tool,
      args: { credential: name },
      resultSummary: summary,
      status: 'ok',
      durationMs: 0,
    });
  }

  async setSecret(
    actorUserId: string,
    id: string,
    ro: ISetAgentSecretRo
  ): Promise<IAgentCredentialVo> {
    const c = await this.credential(id);
    await this.vault.set(id, ro.value, actorUserId, ro.expiresAt ?? null);
    await this.log(actorUserId, 'credential.set', c.name, 'secret set');
    return this.view(id);
  }

  async deleteSecret(actorUserId: string, id: string): Promise<IAgentCredentialVo> {
    const c = await this.credential(id);
    await this.vault.delete(id);
    await this.log(actorUserId, 'credential.delete', c.name, 'secret removed');
    return this.view(id);
  }

  /** GET the first allowed host with the secret; 401/403 marks the credential invalid. */
  async test(actorUserId: string, id: string): Promise<ITestAgentCredentialVo> {
    const c = await this.credential(id);
    const host = c.allowedHosts.find((h) => !h.startsWith('*.'));
    if (!host) {
      return { ok: false, error: 'Add a host without a wildcard to test against.' };
    }
    try {
      const res = await this.execution.run({ runId: 'credential-test', actorUserId }, () =>
        this.http.request({ method: 'GET', url: `https://${host}/`, credential: c.name })
      );
      const rejected = res.status === 401 || res.status === 403;
      if (rejected) await this.store.updateCredential(id, { status: 'invalid' });
      else if (c.status === 'invalid') await this.store.updateCredential(id, { status: 'set' });
      await this.log(actorUserId, 'credential.test', c.name, `HTTP ${res.status}`);
      return { ok: !rejected && res.status < 500, status: res.status };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}

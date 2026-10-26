import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IAgentAuditListVo,
  IAgentAuditQuery,
  IAgentCredentialListVo,
  IAgentSetupVo,
  IUpdateAgentSetupRo,
} from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import type { IAgentProfile, ICredentialRef } from '../../domain/entities';
import {
  AGENT_STORE_PORT,
  AUDIT_PORT,
  type IAgentStorePort,
  type IAuditPort,
} from '../../domain/ports';

const auditPage = 50;

export const toSetupVo = (p: IAgentProfile): IAgentSetupVo => ({
  id: p.id,
  name: p.name,
  persona: p.persona,
  model: p.model,
  smallModel: p.smallModel,
  embeddingModel: p.embeddingModel,
  rerankModel: p.rerankModel,
  temperature: p.temperature,
  maxSteps: p.maxSteps,
  maxOutputTokens: p.maxOutputTokens,
  contextBudgetTokens: p.contextBudgetTokens,
  toolkits: p.toolkits,
  approvalRequired: p.approvalRequired,
  memoryMode: p.memoryMode,
});

export const toCredentialVo = (c: ICredentialRef) => ({
  id: c.id,
  name: c.name,
  description: c.description,
  authKind: c.authKind,
  allowedHosts: c.allowedHosts,
  allowedMethods: c.allowedMethods,
  status: c.status,
  preview: c.preview,
  expiresAt: c.expiresAt,
  lastUsedAt: c.lastUsedAt,
});

/** Admin ▸ Agent (design §13): the default setup, credentials metadata, the audit log. */
@Injectable()
export class ConfigureAgent {
  constructor(
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(AUDIT_PORT) private readonly audit: IAuditPort,
    private readonly prismaService: PrismaService
  ) {}

  private async profile() {
    const profile = await this.store.getDefaultProfile();
    if (!profile) {
      throw new CustomHttpException('The agent has no active setup', HttpErrorCode.NOT_FOUND);
    }
    return profile;
  }

  async getSetup(): Promise<IAgentSetupVo> {
    return toSetupVo(await this.profile());
  }

  async updateSetup(actorUserId: string, ro: IUpdateAgentSetupRo): Promise<IAgentSetupVo> {
    const profile = await this.profile();
    const updated = await this.store.updateProfile(profile.id, ro);
    await this.audit.append({
      runId: 'admin',
      actorUserId,
      tool: 'setup.update',
      args: ro,
      resultSummary: Object.keys(ro).join(', '),
      status: 'ok',
      durationMs: 0,
    });
    return toSetupVo(updated);
  }

  async listCredentials(): Promise<IAgentCredentialListVo> {
    const credentials = await this.store.listCredentials();
    return {
      credentials: credentials.map(toCredentialVo),
    };
  }

  /** Newest first; the cursor is the id of the last entry of the previous page. */
  async listAudit(query: IAgentAuditQuery): Promise<IAgentAuditListVo> {
    const rows = await this.prismaService.agentAuditLog.findMany({
      where: query.runId ? { runId: query.runId } : {},
      orderBy: [{ createdTime: 'desc' }, { id: 'desc' }],
      take: auditPage + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, auditPage);
    return {
      items: page.map((r) => ({
        id: r.id,
        runId: r.runId,
        actorUserId: r.actorUserId,
        tool: r.tool,
        args: r.args,
        resultSummary: r.resultSummary,
        status: r.status,
        durationMs: r.durationMs,
        createdTime: r.createdTime.toISOString(),
      })),
      nextCursor: rows.length > auditPage ? page[page.length - 1].id : null,
    };
  }
}

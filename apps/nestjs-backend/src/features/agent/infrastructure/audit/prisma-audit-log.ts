import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { IAuditEntry, IAuditPort } from '../../domain/ports';
import { auditJson } from '../../domain/redact';

@Injectable()
export class PrismaAuditLog implements IAuditPort {
  constructor(private readonly prismaService: PrismaService) {}

  async append(entry: IAuditEntry): Promise<void> {
    await this.prismaService.agentAuditLog.create({
      data: {
        runId: entry.runId,
        actorUserId: entry.actorUserId,
        tool: entry.tool,
        args: auditJson(entry.args),
        resultSummary: entry.resultSummary?.slice(0, 2_000),
        status: entry.status,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { AgentRun } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type { IAgentRun, IRunStatus, IRunStorePort } from '../../domain/ports';

const parse = <T>(json: string | null): T | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
};

const toRun = (row: AgentRun): IAgentRun => ({
  id: row.id,
  threadId: row.threadRecordId,
  actorUserId: row.actorUserId,
  status: row.status as IRunStatus,
  model: row.model,
  pendingApproval: parse(row.pendingApproval),
  usage: parse(row.usage),
  error: row.error,
});

const finalStatuses: IRunStatus[] = ['done', 'failed', 'cancelled'];

@Injectable()
export class PrismaRunStore implements IRunStorePort {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: { threadId: string; actorUserId: string; model: string | null }) {
    const row = await this.prismaService.agentRun.create({
      data: { threadRecordId: input.threadId, actorUserId: input.actorUserId, model: input.model },
    });
    return toRun(row);
  }

  async get(id: string) {
    const row = await this.prismaService.agentRun.findUnique({ where: { id } });
    return row ? toRun(row) : undefined;
  }

  async update(
    id: string,
    patch: Partial<Pick<IAgentRun, 'status' | 'pendingApproval' | 'usage' | 'error'>>
  ) {
    await this.prismaService.agentRun.update({
      where: { id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.status && finalStatuses.includes(patch.status)
          ? { finishedTime: new Date() }
          : {}),
        ...(patch.pendingApproval !== undefined
          ? {
              pendingApproval: patch.pendingApproval ? JSON.stringify(patch.pendingApproval) : null,
            }
          : {}),
        ...(patch.usage ? { usage: JSON.stringify(patch.usage) } : {}),
        ...(patch.error !== undefined ? { error: patch.error?.slice(0, 2000) ?? null } : {}),
      },
    });
  }

  async activeFor(threadIds: string[]) {
    if (!threadIds.length) return new Map<string, IAgentRun>();
    const rows = await this.prismaService.agentRun.findMany({
      where: {
        threadRecordId: { in: threadIds },
        status: { in: ['running', 'awaiting_approval'] },
      },
      orderBy: { startedTime: 'desc' },
    });
    const out = new Map<string, IAgentRun>();
    for (const row of rows)
      if (!out.has(row.threadRecordId)) out.set(row.threadRecordId, toRun(row));
    return out;
  }
}

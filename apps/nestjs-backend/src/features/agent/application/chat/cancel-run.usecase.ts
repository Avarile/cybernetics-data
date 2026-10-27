import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type { IAgentRunVo } from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import { RUN_STORE_PORT, type IRunStorePort } from '../../domain/ports';
import { RunRegistry } from '../../infrastructure/runs/run-registry';

/** POST /api/agent/runs/:id/cancel (design §10.1 "Cancel"). */
@Injectable()
export class CancelRun {
  constructor(
    @Inject(RUN_STORE_PORT) private readonly runs: IRunStorePort,
    private readonly registry: RunRegistry
  ) {}

  async execute(actorUserId: string, runId: string): Promise<IAgentRunVo> {
    const run = await this.runs.get(runId);
    if (!run || run.actorUserId !== actorUserId) {
      throw new CustomHttpException('Run not found', HttpErrorCode.NOT_FOUND);
    }
    // marked first: a replica that streams this run sees it at its next step
    const cancelled = await this.runs.transition(runId, ['running', 'awaiting_approval'], {
      status: 'cancelled',
      pendingApproval: null,
    });
    if (cancelled) {
      this.registry.abort(runId);
      return { id: run.id, threadId: run.threadId, status: 'cancelled' };
    }
    const now = (await this.runs.get(runId)) ?? run;
    return { id: run.id, threadId: run.threadId, status: now.status };
  }
}

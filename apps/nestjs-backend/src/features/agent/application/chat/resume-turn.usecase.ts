import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type { IAgentChatRo } from '@teable/openapi';
import type { UIMessage } from 'ai';
import { CustomHttpException } from '../../../../custom.exception';
import {
  AGENT_STORE_PORT,
  AUDIT_PORT,
  RUN_STORE_PORT,
  type IAgentStorePort,
  type IAuditPort,
  type IRunStorePort,
} from '../../domain/ports';
import { applyApprovals, pendingApprovalsOf } from '../../runtime/ui-parts';
import { type ITurn, TurnGate } from './turn-gate';

const invalid = (message: string) =>
  new CustomHttpException(message, HttpErrorCode.VALIDATION_ERROR);

/**
 * The admin answered the approvals a run stopped on (design §9.3, §10.1 "Approval resume"): the
 * answers are written into the stored reply and the same run continues from there.
 */
@Injectable()
export class ResumeTurn {
  constructor(
    private readonly gate: TurnGate,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(RUN_STORE_PORT) private readonly runs: IRunStorePort,
    @Inject(AUDIT_PORT) private readonly audit: IAuditPort
  ) {}

  async execute(actorUserId: string, ro: IAgentChatRo): Promise<ITurn> {
    const answers = ro.approvals ?? [];
    // demoted admins are refused here, before anything runs (§9.1)
    const profile = await this.gate.prepare(actorUserId);
    const thread = await this.gate.ownThread(ro.threadId!, actorUserId);
    const release = await this.gate.lock(thread.id);
    try {
      const run = (await this.runs.activeFor([thread.id])).get(thread.id);
      if (run?.status !== 'awaiting_approval') {
        throw new CustomHttpException(
          'Nothing in this thread is waiting for approval',
          HttpErrorCode.CONFLICT
        );
      }
      const recent = await this.store.listMessages(thread.id, { last: 20 });
      const reply = recent.at(-1);
      const parts = JSON.parse(reply?.parts ?? '[]') as UIMessage['parts'];
      if (reply?.role !== 'assistant' || !pendingApprovalsOf(parts).length) {
        throw new CustomHttpException(
          'Nothing in this thread is waiting for approval',
          HttpErrorCode.CONFLICT
        );
      }
      const applied = applyApprovals(parts, answers);
      if (applied.unknown.length) throw invalid(`Unknown approval: ${applied.unknown.join(', ')}`);
      if (applied.missing.length) {
        throw invalid(`Answer every pending approval (missing ${applied.missing.join(', ')})`);
      }
      await this.store.updateMessage(reply.id, { parts: JSON.stringify(applied.parts) });
      await this.auditAnswers(run.id, actorUserId, parts, answers);
      await this.runs.update(run.id, { status: 'running', pendingApproval: null });

      const lastUser = [...recent].reverse().find((m) => m.role === 'user');
      return await this.gate.launch({
        run: { ...run, status: 'running', pendingApproval: null },
        thread,
        profile,
        actorUserId,
        userText: lastUser?.content ?? '',
        context: ro.context,
        release,
      });
    } catch (error) {
      await release();
      throw error;
    }
  }

  private async auditAnswers(
    runId: string,
    actorUserId: string,
    parts: UIMessage['parts'],
    answers: NonNullable<IAgentChatRo['approvals']>
  ) {
    const pending = new Map(pendingApprovalsOf(parts).map((p) => [p.approvalId, p]));
    for (const answer of answers) {
      const call = pending.get(answer.approvalId);
      await this.audit.append({
        runId,
        actorUserId,
        tool: call?.toolName ?? 'unknown',
        args: call?.input,
        resultSummary: answer.reason ?? (answer.approved ? 'approved' : 'rejected'),
        status: answer.approved ? 'approved' : 'rejected',
        durationMs: 0,
      });
    }
  }
}

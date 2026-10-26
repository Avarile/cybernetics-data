import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type { IAgentChatRo } from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import type { IThread } from '../../domain/entities';
import {
  AGENT_STORE_PORT,
  RUN_STORE_PORT,
  type IAgentStorePort,
  type IRunStorePort,
} from '../../domain/ports';
import { denyPending, pendingApprovalsOf } from '../../runtime/ui-parts';
import { type ITurn, TurnGate } from './turn-gate';

const titleLength = 60;
const supersededReason = 'The admin sent a new message instead of answering.';

const parseParts = (json: string | null) => {
  try {
    return json ? (JSON.parse(json) as never[]) : [];
  } catch {
    return [];
  }
};

/** A new message: a new turn (design §10.1). The user message is saved before the model runs. */
@Injectable()
export class RunTurn {
  constructor(
    private readonly gate: TurnGate,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(RUN_STORE_PORT) private readonly runs: IRunStorePort
  ) {}

  async execute(actorUserId: string, ro: IAgentChatRo): Promise<ITurn> {
    const text = ro.message?.text.trim();
    if (!text)
      throw new CustomHttpException('The message is empty', HttpErrorCode.VALIDATION_ERROR);
    const profile = await this.gate.prepare(actorUserId);
    const thread: IThread = ro.threadId
      ? await this.gate.ownThread(ro.threadId, actorUserId)
      : await this.store.createThread({
          title: text.replace(/\s+/g, ' ').slice(0, titleLength),
          ownerId: actorUserId,
          profileId: profile.id,
          focusBaseId: ro.context?.baseId ?? null,
          focusTableId: ro.context?.tableId ?? null,
        });
    const release = await this.gate.lock(thread.id);
    try {
      await this.closeWaitingRun(thread.id);
      await this.store.appendMessages(thread.id, [
        { role: 'user', content: text, parts: JSON.stringify([{ type: 'text', text }]) },
      ]);
      const run = await this.runs.create({
        threadId: thread.id,
        actorUserId,
        model: profile.model,
      });
      return await this.gate.launch({
        run,
        thread,
        profile,
        actorUserId,
        userText: text,
        context: ro.context,
        release,
      });
    } catch (error) {
      await release();
      throw error;
    }
  }

  /** Approvals left unanswered are denied, so the history the model sees stays complete. */
  private async closeWaitingRun(threadId: string) {
    const [last] = await this.store.listMessages(threadId, { last: 1 });
    if (last?.role === 'assistant') {
      const parts = parseParts(last.parts);
      if (pendingApprovalsOf(parts).length) {
        await this.store.updateMessage(last.id, {
          parts: JSON.stringify(denyPending(parts, supersededReason)),
        });
      }
    }
    const waiting = (await this.runs.activeFor([threadId])).get(threadId);
    if (waiting?.status === 'awaiting_approval') {
      await this.runs.update(waiting.id, { status: 'done', pendingApproval: null });
    }
  }
}

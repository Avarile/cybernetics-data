import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type { IAgentChatRo, IChoicePart, IClarifyPart } from '@teable/openapi';
import { AGENT_DATA_PART } from '@teable/openapi';
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
      const choice = ro.message?.choice
        ? await this.resolveChoice(thread.id, ro.message.choice)
        : undefined;
      await this.closeWaitingRun(thread.id);
      const parts = [
        { type: 'text', text },
        ...(choice ? [{ type: AGENT_DATA_PART.choice, data: choice }] : []),
      ];
      await this.store.appendMessages(thread.id, [
        { role: 'user', content: text, parts: JSON.stringify(parts) },
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
        firstTurn: !ro.threadId,
        release,
      });
    } catch (error) {
      await release();
      throw error;
    }
  }

  /**
   * The option the admin picked, as the agent's question offered it (cockpit design §6.4): the
   * label and record come from the stored clarify card, not from the request.
   */
  private async resolveChoice(
    threadId: string,
    choice: NonNullable<NonNullable<IAgentChatRo['message']>['choice']>
  ): Promise<IChoicePart | undefined> {
    const [last] = await this.store.listMessages(threadId, { last: 1 });
    if (last?.role !== 'assistant') return undefined;
    const card = parseParts(last.parts)
      .map((p) => p as { type?: string; data?: IClarifyPart })
      .find((p) => p.type === AGENT_DATA_PART.clarify && p.data?.clarifyId === choice.clarifyId);
    const option = card?.data?.options.find((o) => o.id === choice.optionId);
    if (!option) return undefined;
    return {
      clarifyId: choice.clarifyId,
      optionId: option.id,
      label: option.label,
      ...(option.recordRef ? { recordRef: option.recordRef } : {}),
    };
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
      await this.runs.transition(waiting.id, ['awaiting_approval'], {
        status: 'done',
        pendingApproval: null,
      });
    }
  }
}

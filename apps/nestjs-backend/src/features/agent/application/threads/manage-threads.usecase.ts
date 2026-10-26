import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type {
  IAgentMessageListVo,
  IAgentThreadListQuery,
  IAgentThreadListVo,
  IAgentThreadVo,
  IUpdateAgentThreadRo,
} from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import type { IThread } from '../../domain/entities';
import {
  AGENT_STORE_PORT,
  RUN_STORE_PORT,
  type IAgentRun,
  type IAgentStorePort,
  type IRunStorePort,
} from '../../domain/ports';
import { toUIMessage } from '../../runtime/message-mapper';

const pageSize = 30;

const toVo = (t: IThread, run?: IAgentRun): IAgentThreadVo => ({
  id: t.id,
  title: t.title,
  status: t.status,
  messageCount: t.messageCount,
  lastMessageAt: t.lastMessageAt,
  createdAt: t.createdAt,
  tokensIn: t.tokensIn,
  tokensOut: t.tokensOut,
  costUsd: t.costUsd,
  activeRun:
    run && (run.status === 'running' || run.status === 'awaiting_approval')
      ? { id: run.id, status: run.status }
      : null,
});

/** The caller's threads (design §12): list, read, rename/archive, delete. */
@Injectable()
export class ManageThreads {
  constructor(
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(RUN_STORE_PORT) private readonly runs: IRunStorePort
  ) {}

  private async own(threadId: string, actorUserId: string) {
    const thread = await this.store.getThread(threadId).catch(() => undefined);
    if (!thread || thread.ownerId !== actorUserId) {
      throw new CustomHttpException('Thread not found', HttpErrorCode.NOT_FOUND);
    }
    return thread;
  }

  async list(actorUserId: string, query: IAgentThreadListQuery): Promise<IAgentThreadListVo> {
    const skip = Number(query.cursor ?? 0);
    const threads = await this.store.listThreads({
      ownerId: actorUserId,
      status: query.status,
      take: pageSize,
      skip,
    });
    const active = await this.runs.activeFor(threads.map((t) => t.id));
    return {
      threads: threads.map((t) => toVo(t, active.get(t.id))),
      nextCursor: threads.length === pageSize ? String(skip + pageSize) : null,
    };
  }

  async get(actorUserId: string, threadId: string): Promise<IAgentThreadVo> {
    const thread = await this.own(threadId, actorUserId);
    return toVo(thread, (await this.runs.activeFor([threadId])).get(threadId));
  }

  async update(
    actorUserId: string,
    threadId: string,
    ro: IUpdateAgentThreadRo
  ): Promise<IAgentThreadVo> {
    await this.own(threadId, actorUserId);
    const thread = await this.store.updateThread(threadId, ro);
    return toVo(thread, (await this.runs.activeFor([threadId])).get(threadId));
  }

  async delete(actorUserId: string, threadId: string): Promise<void> {
    await this.own(threadId, actorUserId);
    const run = (await this.runs.activeFor([threadId])).get(threadId);
    if (run?.status === 'running') {
      throw new CustomHttpException('Stop the running reply first', HttpErrorCode.CONFLICT);
    }
    await this.store.deleteThread(threadId);
  }

  async messages(actorUserId: string, threadId: string): Promise<IAgentMessageListVo> {
    await this.own(threadId, actorUserId);
    const messages = await this.store.listMessages(threadId);
    return {
      messages: messages.flatMap((m) => {
        const ui = toUIMessage(m);
        return ui
          ? [
              {
                id: m.id,
                role: ui.role as 'user' | 'assistant',
                parts: ui.parts as unknown as Record<string, unknown>[],
                seq: m.seq,
                model: m.model,
                createdAt: m.createdAt,
              },
            ]
          : [];
      }),
    };
  }
}

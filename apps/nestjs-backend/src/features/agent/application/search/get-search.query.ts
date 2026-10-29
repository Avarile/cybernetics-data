import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type { IAgentSearchListVo, IAgentSearchVo } from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import {
  AGENT_STORE_PORT,
  SEARCH_LOG_PORT,
  type IAgentStorePort,
  type ISearchLogPort,
  type IStoredSearch,
} from '../../domain/ports';

const toVo = (s: IStoredSearch): IAgentSearchVo => ({
  id: s.id,
  runId: s.runId,
  threadId: s.threadId,
  intent: s.intent,
  plan: s.plan,
  states: s.states,
  cards: s.cards,
  lens: s.lens,
  status: s.status,
  createdAt: s.createdAt,
});

/** Cockpit design §7.3: a stored search for the board, only for the owner of its thread. */
@Injectable()
export class GetSearch {
  constructor(
    @Inject(SEARCH_LOG_PORT) private readonly log: ISearchLogPort,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {}

  private async ownThread(threadId: string, actorUserId: string) {
    const thread = await this.store.getThread(threadId).catch(() => undefined);
    return Boolean(thread && thread.ownerId === actorUserId);
  }

  async get(actorUserId: string, searchId: string): Promise<IAgentSearchVo> {
    const search = await this.log.get(searchId);
    if (!search || !(await this.ownThread(search.threadId, actorUserId))) {
      throw new CustomHttpException('Search not found', HttpErrorCode.NOT_FOUND);
    }
    return toVo(search);
  }

  async list(actorUserId: string, threadId: string): Promise<IAgentSearchListVo> {
    if (!(await this.ownThread(threadId, actorUserId))) {
      throw new CustomHttpException('Thread not found', HttpErrorCode.NOT_FOUND);
    }
    const searches = await this.log.listByThread(threadId);
    return {
      searches: searches.map((s) => ({
        id: s.id,
        runId: s.runId,
        intent: s.intent,
        summary: s.plan.summary ?? '',
        status: s.status,
        createdAt: s.createdAt,
      })),
    };
  }
}

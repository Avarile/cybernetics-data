import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { IAgentChatContext } from '@teable/openapi';
import type { UIMessageChunk } from 'ai';
import { CacheService } from '../../../../cache/cache.service';
import { CustomHttpException } from '../../../../custom.exception';
import type { IAgentProfile, IThread } from '../../domain/entities';
import { AGENT_STORE_PORT, type IAgentRun, type IAgentStorePort } from '../../domain/ports';
import { RunRegistry } from '../../infrastructure/runs/run-registry';
import { AgentRuntime, TURN_TIMEOUT_MS } from '../../runtime/agent-runtime';
import { EnsureInstallation } from '../installation/ensure-installation.usecase';

export interface ITurn {
  threadId: string;
  runId: string;
  stream: ReadableStream<UIMessageChunk>;
  /** The client went away: stop the run (its messages so far are kept). */
  abort(): void;
}

const notFound = () => new CustomHttpException('Thread not found', HttpErrorCode.NOT_FOUND);

/** What every turn checks before it runs (design §9.1 run-time check, §10.1 step 1). */
@Injectable()
export class TurnGate {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly installation: EnsureInstallation,
    private readonly cacheService: CacheService,
    private readonly registry: RunRegistry,
    private readonly runtime: AgentRuntime,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort
  ) {}

  /** Admin right now (read from the database, not the session), healthy install, a profile. */
  async prepare(actorUserId: string): Promise<IAgentProfile> {
    const user = await this.prismaService.user.findUnique({
      where: { id: actorUserId },
      select: { isAdmin: true, deactivatedTime: true, deletedTime: true },
    });
    if (!user?.isAdmin || user.deactivatedTime || user.deletedTime) {
      throw new CustomHttpException(
        'Only instance admins can use the agent',
        HttpErrorCode.RESTRICTED_RESOURCE
      );
    }
    await this.installation.ensureFresh();
    const profile = await this.store.getDefaultProfile();
    if (!profile) {
      throw new CustomHttpException(
        'The agent has no active setup. Turn one on in the agent_setup table.',
        HttpErrorCode.CONFLICT
      );
    }
    return profile;
  }

  /** The caller's own thread; anyone else's reads as missing. */
  async ownThread(threadId: string, actorUserId: string): Promise<IThread> {
    const thread = await this.store.getThread(threadId).catch(() => undefined);
    if (!thread || thread.ownerId !== actorUserId) throw notFound();
    return thread;
  }

  /** One run per thread at a time, across replicas. Returns the release function. */
  async lock(threadId: string): Promise<() => Promise<void>> {
    const key = `lock:agent-thread:${threadId}` as const;
    const ttl = Math.ceil(TURN_TIMEOUT_MS / 1000) + 30;
    if (!(await this.cacheService.setnx(key, threadId, ttl))) {
      throw new CustomHttpException(
        'This thread already has a reply in progress. Wait for it or stop it first.',
        HttpErrorCode.CONFLICT
      );
    }
    return () => this.cacheService.del(key);
  }

  async launch(input: {
    run: IAgentRun;
    thread: IThread;
    profile: IAgentProfile;
    actorUserId: string;
    userText: string;
    context?: IAgentChatContext;
    release: () => Promise<void>;
  }): Promise<ITurn> {
    const controller = this.registry.open(input.run.id);
    const settle = async () => {
      this.registry.close(input.run.id);
      await input.release();
    };
    try {
      const stream = await this.runtime.start({
        run: input.run,
        thread: input.thread,
        profile: input.profile,
        actorUserId: input.actorUserId,
        focus: input.context,
        userText: input.userText,
        controller,
        onSettled: settle,
      });
      return {
        threadId: input.thread.id,
        runId: input.run.id,
        stream,
        abort: () => this.registry.abort(input.run.id, 'client closed the connection'),
      };
    } catch (error) {
      await settle();
      throw error;
    }
  }
}

import { AGENT_ROBOT_ID } from '@cybernetics/core';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../../../cache/cache.service';
import { RAG_STORE_PORT, type IRagStorePort, type ISyncState } from '../../domain/ports';
import { SearchTables } from '../../infrastructure/knowledge/search-tables';
import { FULL_SYNC, KnowledgeSync } from './knowledge-sync';

const BOOT_DELAY_MS = 30_000;
const TICK_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A failed full sync is tried again after an hour, not a day. */
const RETRY_MS = 60 * 60 * 1000;
/** A full sync running longer than this crashed. */
const STALE_MS = 2 * 60 * 60 * 1000;

/** Whether the full sync is due: never ran, a day old, failed an hour ago, or crashed. */
export function fullSyncDue(state: ISyncState | undefined, now = Date.now()) {
  if (!state) return true;
  if (state.status === 'running') return now - (state.startedTime?.getTime() ?? 0) > STALE_MS;
  const since = now - (state.finishedTime?.getTime() ?? 0);
  return state.status === 'failed' ? since > RETRY_MS : since > DAY_MS;
}

/**
 * Queues the full search sync when it is due (current-design §4.6): shortly after boot (it catches
 * changes made while no server ran), then daily (it catches lookup and formula values that changed
 * through edits in other tables). A timer, like the email sync scheduler, so it works without
 * Redis; one tick lock serves all instances.
 */
@Injectable()
export class KnowledgeSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeSyncScheduler.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(RAG_STORE_PORT) private readonly rag: IRagStorePort,
    private readonly tables: SearchTables,
    private readonly sync: KnowledgeSync,
    private readonly cacheService: CacheService
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () =>
      this.tick().catch((error) => this.logger.error(`Search sync tick failed: ${error}`));
    this.timers = [setTimeout(run, BOOT_DELAY_MS), setInterval(run, TICK_MS)];
    this.timers.forEach((t) => t.unref());
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** Queues the full sync when the agent is on and it is due; true when it queued one. */
  async tick() {
    const lock = 'lock:agent-rag:tick' as const;
    if (!(await this.cacheService.setnx(lock, 'tick', TICK_MS / 1000 - 60))) return false;
    if (!(await this.tables.currentSettings())) return false;
    if (!fullSyncDue(await this.rag.getSyncState(FULL_SYNC))) return false;
    await this.sync.enqueueFullSync(AGENT_ROBOT_ID);
    return true;
  }
}

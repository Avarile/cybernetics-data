/* eslint-disable @typescript-eslint/naming-convention */
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { IEmailSourceConfig } from '@teable/openapi';
import { EmailSourceStatus } from '@teable/openapi';
import { CacheService } from '../../../cache/cache.service';
import { EmailSyncQueueProcessor } from './email-sync.processor';

const TICK_SECONDS = 60;
// a run marked as syncing for longer than this crashed; let it start again
const STALE_SYNC_MS = 30 * 60_000;

/**
 * Every minute, queues the email tables that are due. Works without Redis (the fallback queue
 * has no repeatable jobs); with several instances, one tick lock keeps them from all queuing.
 */
@Injectable()
export class EmailSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailSyncScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly processor: EmailSyncQueueProcessor
  ) {}

  onModuleInit() {
    if (process.env.EMAIL_SYNC_DISABLED === 'true' || process.env.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.logger.error(`Email sync tick failed: ${error}`));
    }, TICK_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick(now = Date.now()) {
    if (!(await this.cacheService.setnx('lock:email-sync:tick', 'tick', TICK_SECONDS - 5))) {
      return;
    }
    const sources = await this.prismaService.emailSource.findMany({
      where: {
        deletedTime: null,
        status: {
          in: [EmailSourceStatus.Idle, EmailSourceStatus.Error, EmailSourceStatus.Syncing],
        },
      },
      select: {
        id: true,
        status: true,
        config: true,
        lastSyncedTime: true,
        lastModifiedTime: true,
      },
    });
    for (const source of sources) {
      if (isDue(source, now)) {
        await this.processor.enqueue(source.id);
      }
    }
  }
}

export const isDue = (
  source: {
    status: string;
    config: string;
    lastSyncedTime: Date | null;
    lastModifiedTime: Date | null;
  },
  now: number
) => {
  if (source.status === EmailSourceStatus.Syncing) {
    return now - (source.lastModifiedTime?.getTime() ?? 0) > STALE_SYNC_MS;
  }
  const { intervalMin } = JSON.parse(source.config) as IEmailSourceConfig;
  // after a failure, wait a full interval from the failure, not from the last success
  const since =
    source.status === EmailSourceStatus.Error ? source.lastModifiedTime : source.lastSyncedTime;
  return !since || now - since.getTime() >= intervalMin * 60_000;
};

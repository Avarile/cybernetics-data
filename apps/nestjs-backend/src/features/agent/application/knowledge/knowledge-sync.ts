import { AGENT_ROBOT_ID, HttpErrorCode } from '@cybernetics/core';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CacheService } from '../../../../cache/cache.service';
import { CustomHttpException } from '../../../../custom.exception';
import {
  RAG_SOURCE_READER_PORT,
  RAG_STORE_PORT,
  type IRagSource,
  type IRagSourceReaderPort,
  type IRagStorePort,
} from '../../domain/ports';
import { documentIdFor } from '../../infrastructure/knowledge/pg-rag-store';
import {
  DERIVED_COLLECTIONS,
  SearchTables,
  type ISearchTarget,
} from '../../infrastructure/knowledge/search-tables';
import { KnowledgeIngest } from './knowledge-ingest';
import { RAG_JOBS_QUEUE, sourceRefOf, type IRagJobData } from './rag-jobs';

const jobOptions = { attempts: 3, backoff: { type: 'exponential' as const, delay: 3000 } };
/** Records an ingest-records job takes at most. */
const recordBatch = 200;
const fullSyncLock = 'lock:agent-rag:full-sync' as const;
/** Set when a full sync was asked for while one ran: it runs once more when that one ends. */
const fullSyncAgain = 'lock:agent-rag:full-sync-again' as const;
const fullSyncLockSeconds = 2 * 60 * 60;
/** The sync_state row of the full sync. */
export const FULL_SYNC = '*';

export interface ISyncSummary {
  tables: number;
  records: number;
  indexed: number;
  unchanged: number;
  removed: number;
  failed: number;
  /** The first errors, to show what went wrong. */
  errors: string[];
}

const emptySummary = (): ISyncSummary => ({
  tables: 0,
  records: 0,
  indexed: 0,
  unchanged: 0,
  removed: 0,
  failed: 0,
  errors: [],
});

const noteError = (summary: ISyncSummary, what: string, error: unknown) => {
  summary.failed++;
  if (summary.errors.length < 5) {
    summary.errors.push(`${what}: ${(error as Error)?.message?.slice(0, 200) ?? String(error)}`);
  }
};

/**
 * Keeps search in step with the tables (current-design §4.6). Record events index the records
 * that changed; a table whose fields changed is synced again; the full sync (on enable, at boot,
 * nightly, after the search settings change, or by an admin) indexes every target table a page
 * at a time, re-chunks only what changed (content hash), and drops documents of records, tables
 * and collections that are no longer searched. The work runs as rag jobs.
 */
@Injectable()
export class KnowledgeSync {
  private readonly logger = new Logger(KnowledgeSync.name);

  constructor(
    @Inject(RAG_STORE_PORT) private readonly rag: IRagStorePort,
    @Inject(RAG_SOURCE_READER_PORT) private readonly reader: IRagSourceReaderPort,
    private readonly ingest: KnowledgeIngest,
    private readonly tables: SearchTables,
    private readonly cacheService: CacheService,
    @InjectQueue(RAG_JOBS_QUEUE) private readonly queue: Queue<IRagJobData>
  ) {}

  // ── queueing ──────────────────────────────────────────────────────────────

  /** Records changed: one job per batch of them. */
  async enqueueRecords(
    target: ISearchTarget,
    tableId: string,
    recordIds: string[],
    actorUserId: string
  ) {
    for (let i = 0; i < recordIds.length; i += recordBatch) {
      await this.queue.add(
        'ingest-records',
        {
          actorUserId,
          collectionId: target.collectionId,
          baseId: target.baseId,
          tableId,
          recordIds: recordIds.slice(i, i + recordBatch),
        },
        jobOptions
      );
    }
  }

  /** Records deleted: their documents go. */
  async enqueueRemovals(
    target: ISearchTarget,
    tableId: string,
    recordIds: string[],
    actorUserId: string
  ) {
    if (!recordIds.length) return;
    await this.queue.addBulk(
      recordIds.map((recordId) => {
        const source: IRagSource = { kind: 'record', baseId: target.baseId, tableId, recordId };
        const documentId = documentIdFor(target.collectionId, sourceRefOf(source));
        return { name: 'remove', data: { actorUserId, documentId }, opts: jobOptions };
      })
    );
  }

  async enqueueTable(name: 'sync-table' | 'remove-table', tableId: string, actorUserId: string) {
    await this.queue.add(name, { actorUserId, tableId }, jobOptions);
  }

  async enqueueFullSync(actorUserId: string) {
    await this.queue.add('sync', { actorUserId }, jobOptions);
  }

  // ── work ──────────────────────────────────────────────────────────────────

  /**
   * Every target table, then documents of tables no longer searched. One at a time: asked for
   * while one runs, it answers 409 and that one runs again when it ends (the settings may have
   * changed after it read them).
   */
  async syncAll(): Promise<ISyncSummary> {
    if (!(await this.cacheService.setnx(fullSyncLock, 'sync', fullSyncLockSeconds))) {
      await this.cacheService.setDetail(fullSyncAgain, 'again', fullSyncLockSeconds);
      throw new CustomHttpException('A full search sync is running', HttpErrorCode.CONFLICT);
    }
    await this.cacheService.del(fullSyncAgain);
    const summary = emptySummary();
    try {
      await this.rag.setSyncState(FULL_SYNC, {
        status: 'running',
        startedTime: new Date(),
        error: null,
      });
      this.tables.invalidate();
      const targets = await this.tables.allTargets();
      for (const target of targets) await this.indexTable(target, summary);

      const searched = new Set(targets.map((t) => `${t.collectionId}:${t.tableId}`));
      for (const { collectionId, tableId } of await this.rag.listIndexedTables(
        DERIVED_COLLECTIONS
      )) {
        if (!searched.has(`${collectionId}:${tableId}`)) {
          summary.removed += await this.rag.deleteTableDocuments(tableId, [collectionId]);
        }
      }
      await this.rag.setSyncState(FULL_SYNC, {
        status: 'done',
        records: summary.records,
        finishedTime: new Date(),
        error: summary.errors[0] ?? null,
      });
      this.logger.log(`search sync: ${JSON.stringify({ ...summary, errors: undefined })}`);
      if (summary.errors.length)
        this.logger.warn(`search sync errors: ${summary.errors.join(' | ')}`);
      return summary;
    } catch (error) {
      await this.rag
        .setSyncState(FULL_SYNC, {
          status: 'failed',
          finishedTime: new Date(),
          error: (error as Error).message,
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await this.cacheService.del(fullSyncLock);
      if (await this.cacheService.get(fullSyncAgain)) {
        await this.enqueueFullSync(AGENT_ROBOT_ID).catch(() => undefined);
      }
    }
  }

  /** One table, after its fields changed: indexed again, or its documents dropped. */
  async syncTable(tableId: string): Promise<ISyncSummary> {
    const summary = emptySummary();
    this.tables.invalidate();
    const target = await this.tables.targetFor(tableId);
    const dbTableName = target && (await this.tables.dbTableName(tableId));
    if (!target || !dbTableName) {
      summary.removed += await this.removeTable(tableId);
      return summary;
    }
    await this.indexTable({ ...target, tableId, dbTableName }, summary);
    return summary;
  }

  /** A deleted table: every document of its records goes. */
  async removeTable(tableId: string) {
    return this.rag.deleteTableDocuments(tableId, DERIVED_COLLECTIONS);
  }

  /** Records of one table, read together; each is indexed, skipped when unchanged, or removed. */
  async indexRecords(
    collectionId: string,
    baseId: string,
    tableId: string,
    recordIds: string[],
    summary = emptySummary()
  ) {
    const reads = await this.reader.readRecords(tableId, recordIds, collectionId);
    const sources = recordIds.map(
      (recordId): IRagSource => ({ kind: 'record', baseId, tableId, recordId })
    );
    const existing = new Map(
      (
        await this.rag.getDocuments(sources.map((s) => documentIdFor(collectionId, sourceRefOf(s))))
      ).map((d) => [d.id, d])
    );
    for (const source of sources) {
      if (source.kind !== 'record') continue;
      summary.records++;
      const documentId = documentIdFor(collectionId, sourceRefOf(source));
      try {
        const outcome = await this.ingest.apply(collectionId, source, reads.get(source.recordId), {
          existing: existing.get(documentId) ?? null,
        });
        if (outcome.status === 'removed') {
          if (existing.has(documentId)) summary.removed++;
        } else if (outcome.unchanged) summary.unchanged++;
        else summary.indexed++;
      } catch (error) {
        noteError(summary, source.recordId, error);
        if (existing.has(documentId)) {
          await this.rag
            .setDocumentStatus(documentId, 'failed', (error as Error).message)
            .catch(() => undefined);
        }
      }
    }
    return summary;
  }

  /**
   * Every record of the table, a page at a time; then the table's documents that are no longer
   * right go: records that are gone, and documents in another collection (the table moved, e.g.
   * it became a knowledge table).
   */
  private async indexTable(
    target: ISearchTarget & { tableId: string; dbTableName: string },
    summary: ISyncSummary
  ) {
    const { tableId, collectionId, baseId } = target;
    summary.tables++;
    const before = summary.records;
    try {
      await this.rag.setSyncState(tableId, {
        collectionId,
        status: 'running',
        startedTime: new Date(),
        error: null,
      });
      const seen = new Set<string>();
      for await (const page of this.tables.recordIds(target.dbTableName)) {
        for (const recordId of page) {
          seen.add(
            documentIdFor(collectionId, sourceRefOf({ kind: 'record', baseId, tableId, recordId }))
          );
        }
        await this.indexRecords(collectionId, baseId, tableId, page, summary);
      }
      const stale = (await this.rag.listTableDocuments(tableId, DERIVED_COLLECTIONS)).filter(
        (d) => d.collectionId !== collectionId || !seen.has(d.id)
      );
      await this.rag.deleteDocuments(stale.map((d) => d.id));
      summary.removed += stale.length;
      await this.rag.setSyncState(tableId, {
        status: 'done',
        records: summary.records - before,
        finishedTime: new Date(),
      });
    } catch (error) {
      noteError(summary, tableId, error);
      await this.rag
        .setSyncState(tableId, {
          status: 'failed',
          finishedTime: new Date(),
          error: (error as Error).message,
        })
        .catch(() => undefined);
    }
  }
}

import { HttpErrorCode } from '@cybernetics/core';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CustomHttpException } from '../../../../custom.exception';
import {
  RAG_SOURCE_READER_PORT,
  RAG_STORE_PORT,
  type IRagDocument,
  type IRagSource,
  type IRagSourceReaderPort,
  type IRagStorePort,
} from '../../domain/ports';
import { chunkDocument, chunkRecord } from '../../infrastructure/knowledge/chunker';
import { KnowledgeTables } from '../../infrastructure/knowledge/knowledge-tables';
import { documentIdFor, embeddingText } from '../../infrastructure/knowledge/pg-rag-store';
import { EmbeddingSpaces } from './embedding-spaces';
import { RAG_JOBS_QUEUE, sha256, sourceRefOf, type IRagJobData } from './rag-jobs';

/** Larger extracted texts are refused rather than chunked into thousands of pieces. */
export const MAX_DOCUMENT_CHARS = 2_000_000;
/** rag_ingest waits this long, so small texts come back ready within the turn (§11.3). */
export const INGEST_WAIT_MS = 10_000;

const jobOptions = { attempts: 3, backoff: { type: 'exponential' as const, delay: 3000 } };
const pollMs = 250;
const settled = (d?: IRagDocument) => !d || d.status === 'ready' || d.status === 'failed';

export interface IIngestRequest {
  collectionId: string;
  source: IRagSource;
  title?: string | null;
  actorUserId: string;
  waitMs?: number;
}

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

export type IIngestOutcome =
  | { status: 'ready'; chunkCount: number; unchanged: boolean }
  | { status: 'removed' };

const recordIds = (source: IRagSource) =>
  source.kind === 'record'
    ? { baseId: source.baseId, tableId: source.tableId, recordId: source.recordId }
    : { baseId: null, tableId: null, recordId: null };

/**
 * Background, idempotent, atomic ingest (design §11.3): extract → hash → skip when unchanged and
 * fully embedded → chunk → embed for every target space → one transaction replaces the chunks.
 */
@Injectable()
export class KnowledgeIngest {
  private readonly logger = new Logger(KnowledgeIngest.name);
  /** The full sync this process started on the first knowledge search. */
  private firstSync?: Promise<unknown>;

  constructor(
    @Inject(RAG_STORE_PORT) private readonly rag: IRagStorePort,
    @Inject(RAG_SOURCE_READER_PORT) private readonly reader: IRagSourceReaderPort,
    private readonly spaces: EmbeddingSpaces,
    private readonly tables: KnowledgeTables,
    @InjectQueue(RAG_JOBS_QUEUE) private readonly queue: Queue<IRagJobData>
  ) {}

  /**
   * Index every record of every knowledge table and of agent_memory, one at a time. Record events
   * only cover changes made while the agent runs; this catches up with records that existed
   * before (or changed while the server was down). Unchanged records cost a hash comparison;
   * documents whose records are gone are removed.
   */
  async syncAll(actorUserId: string): Promise<ISyncSummary> {
    const summary: ISyncSummary = {
      tables: 0,
      records: 0,
      indexed: 0,
      unchanged: 0,
      removed: 0,
      failed: 0,
      errors: [],
    };
    const seen = new Map<string, Set<string>>();
    for (const target of await this.tables.allTargets()) {
      summary.tables++;
      const ids = seen.get(target.collectionId) ?? new Set<string>();
      seen.set(target.collectionId, ids);
      for await (const page of this.tables.recordIds(target.dbTableName)) {
        for (const recordId of page) {
          const source: IRagSource = {
            kind: 'record',
            baseId: target.baseId,
            tableId: target.tableId,
            recordId,
          };
          ids.add(documentIdFor(target.collectionId, sourceRefOf(source)));
          await this.syncRecord(summary, actorUserId, target.collectionId, source);
        }
      }
    }
    summary.removed += await this.removeOrphans(seen);
    this.logger.log(`knowledge sync: ${JSON.stringify({ ...summary, errors: undefined })}`);
    if (summary.errors.length)
      this.logger.warn(`knowledge sync errors: ${summary.errors.join(' | ')}`);
    return summary;
  }

  private async syncRecord(
    summary: ISyncSummary,
    actorUserId: string,
    collectionId: string,
    source: IRagSource
  ) {
    summary.records++;
    try {
      const outcome = await this.ingest({ actorUserId, collectionId, source });
      if (outcome.status === 'removed') summary.removed++;
      else if (outcome.unchanged) summary.unchanged++;
      else summary.indexed++;
    } catch (error) {
      summary.failed++;
      if (summary.errors.length < 5) {
        const id = source.kind === 'record' ? source.recordId : '';
        summary.errors.push(`${id}: ${(error as Error).message.slice(0, 200)}`);
      }
    }
  }

  /** Documents of records that no longer exist (deleted while the server was down). */
  private async removeOrphans(seen: Map<string, Set<string>>) {
    let removed = 0;
    for (const [collectionId, ids] of seen) {
      for (const doc of await this.rag.listDocuments(collectionId, 100_000)) {
        if (doc.recordId && !ids.has(doc.id)) {
          await this.rag.deleteDocument(doc.id);
          removed++;
        }
      }
    }
    return removed;
  }

  /**
   * The first knowledge search in this process starts a full sync and waits for it a little;
   * `pending` says it is still running (results may be incomplete).
   */
  async ensureSynced(actorUserId: string, waitMs = INGEST_WAIT_MS): Promise<{ pending: boolean }> {
    if (!this.firstSync) {
      this.firstSync = this.syncAll(actorUserId).catch((error) => {
        this.logger.warn(`knowledge sync failed: ${(error as Error).message}`);
        this.firstSync = undefined; // try again on the next search
      });
    }
    let timer: NodeJS.Timeout | undefined;
    const done = await Promise.race([
      this.firstSync.then(() => true),
      new Promise<boolean>((r) => (timer = setTimeout(() => r(false), waitMs))),
    ]);
    clearTimeout(timer);
    return { pending: !done };
  }

  /** rag_ingest: queue a document, then wait a little for it. */
  async request(req: IIngestRequest) {
    const collection = (await this.rag.listCollections()).find((c) => c.id === req.collectionId);
    if (!collection) {
      throw new CustomHttpException(
        `No collection ${req.collectionId}; collection_list shows them`,
        HttpErrorCode.NOT_FOUND
      );
    }
    if (collection.kind === 'derived' && req.source.kind !== 'record') {
      throw new CustomHttpException(
        `${req.collectionId} is kept in sync from tables; ingest documents into another collection`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    const sourceRef = sourceRefOf(req.source);
    const existing = await this.rag.getDocument(documentIdFor(req.collectionId, sourceRef));
    const doc = await this.rag.upsertDocument({
      collectionId: req.collectionId,
      sourceRef,
      title: req.title ?? existing?.title ?? null,
      contentHash: existing?.contentHash ?? '',
      status: 'queued',
      ...recordIds(req.source),
    });
    const job = await this.queue.add(
      'ingest',
      {
        collectionId: req.collectionId,
        source: req.source,
        title: req.title ?? null,
        actorUserId: req.actorUserId,
      },
      jobOptions
    );
    const final = await this.waitFor(doc.id, req.waitMs ?? INGEST_WAIT_MS);
    return {
      documentId: doc.id,
      jobId: job.id ?? null,
      status: final?.status ?? 'queued',
      chunkCount: final?.chunkCount ?? 0,
      error: final?.error ?? null,
    };
  }

  /** Derived sync (design §11.3): a record changed or was deleted. */
  async enqueueRecords(
    collectionId: string,
    refs: { baseId: string; tableId: string; recordId: string }[],
    actorUserId: string,
    removed = false
  ) {
    if (!refs.length) return;
    await this.queue.addBulk(
      refs.map((ref) => {
        const source: IRagSource = { kind: 'record', ...ref };
        const data: IRagJobData = removed
          ? { actorUserId, documentId: documentIdFor(collectionId, sourceRefOf(source)) }
          : { actorUserId, collectionId, source };
        return { name: removed ? 'remove' : 'ingest', data, opts: jobOptions };
      })
    );
  }

  /** The embedding model may have changed: build its space in the background. */
  async enqueueSpaceCheck(actorUserId: string) {
    await this.queue.add('ensure-space', { actorUserId }, jobOptions);
  }

  async status(documentId: string) {
    return this.rag.getDocument(documentId);
  }

  async waitFor(documentId: string, ms: number) {
    const until = Date.now() + ms;
    let doc = await this.rag.getDocument(documentId);
    while (!settled(doc) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, pollMs));
      doc = await this.rag.getDocument(documentId);
    }
    return doc;
  }

  async remove(documentId: string): Promise<IIngestOutcome> {
    await this.rag.deleteDocument(documentId);
    return { status: 'removed' };
  }

  /** The ingest job. Marks the document failed (and rethrows, for a retry) on errors. */
  async ingest(data: IRagJobData): Promise<IIngestOutcome> {
    const { collectionId, source } = data;
    if (!collectionId || !source) throw new Error('ingest job without collection or source');
    const documentId = documentIdFor(collectionId, sourceRefOf(source));
    try {
      return await this.run(data, collectionId, source, documentId);
    } catch (error) {
      await this.rag
        .setDocumentStatus(documentId, 'failed', (error as Error).message.slice(0, 1000))
        .catch(() => undefined);
      throw error;
    }
  }

  private async run(
    data: IRagJobData,
    collectionId: string,
    source: IRagSource,
    documentId: string
  ): Promise<IIngestOutcome> {
    const read = await this.reader.read(source);
    if (!read) return this.remove(documentId);
    if (read.text.length > MAX_DOCUMENT_CHARS) {
      throw new Error(
        `The text has ${read.text.length} characters; the limit is ${MAX_DOCUMENT_CHARS}`
      );
    }
    const existing = await this.rag.getDocument(documentId);
    const title = data.title ?? existing?.title ?? read.title;
    const hash = sha256(`${title ?? ''}\n${read.text}`);
    const spaces = await this.spaces.targets(data.actorUserId);

    if (existing?.contentHash === hash && existing.chunkCount > 0) {
      const embedded = await Promise.all(
        spaces.map((s) => this.rag.hasAllEmbeddings(documentId, s.slug))
      );
      if (embedded.every(Boolean)) {
        if (existing.status !== 'ready') await this.rag.setDocumentStatus(documentId, 'ready');
        return { status: 'ready', chunkCount: existing.chunkCount, unchanged: true };
      }
    }

    await this.rag.upsertDocument({
      collectionId,
      sourceRef: sourceRefOf(source),
      title,
      contentHash: hash,
      status: 'processing',
      ...recordIds(source),
    });
    const sections =
      read.format === 'record'
        ? chunkRecord(title, read.text)
        : chunkDocument(read.text, read.format);
    const texts = sections.flatMap((s) =>
      s.chunks.map((chunk) => embeddingText(title, s.headingPath, chunk))
    );
    const embeddings = [];
    for (const space of spaces) {
      embeddings.push({ space: space.slug, vectors: await this.spaces.embed(space.model, texts) });
    }
    const chunkCount = await this.rag.replaceChunks(documentId, sections, embeddings);
    return { status: 'ready', chunkCount, unchanged: false };
  }
}

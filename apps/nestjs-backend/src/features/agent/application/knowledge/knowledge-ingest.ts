import { HttpErrorCode } from '@cybernetics/core';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
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
  constructor(
    @Inject(RAG_STORE_PORT) private readonly rag: IRagStorePort,
    @Inject(RAG_SOURCE_READER_PORT) private readonly reader: IRagSourceReaderPort,
    private readonly spaces: EmbeddingSpaces,
    @InjectQueue(RAG_JOBS_QUEUE) private readonly queue: Queue<IRagJobData>
  ) {}

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

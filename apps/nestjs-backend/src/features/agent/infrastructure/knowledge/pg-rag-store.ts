import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import knex from 'knex';
import type {
  IRagCollection,
  IRagDocument,
  IRagDocumentStatus,
  IRagHit,
  IRagQuery,
  IRagSection,
  IRagStorePort,
  ISyncState,
} from '../../domain/ports';
import { buildSearchQuery, searchableText } from './rag-query';
import { RAG_SCHEMA, RAG_SCHEMA_STATEMENTS } from './rag-schema';

export const documentIdFor = (collectionId: string, sourceRef: string) =>
  createHash('sha256').update(`${collectionId}:${sourceRef}`).digest('hex');

type IRow = Record<string, unknown>;
/** Prisma's client and its interactive-transaction client share these. */
type IRaw = Pick<PrismaService, '$queryRawUnsafe' | '$executeRawUnsafe'>;

/** Builds SQL only; the queries run through Prisma on the main database. */
const qb = knex({ client: 'pg' });
const collectionTable = `${RAG_SCHEMA}.collection`;
const documentTable = `${RAG_SCHEMA}.document`;
const chunkTable = `${RAG_SCHEMA}.chunk`;
const syncTable = `${RAG_SCHEMA}.sync_state`;

const toCollection = (r: IRow): IRagCollection => ({
  id: String(r.id),
  label: String(r.label),
  description: (r.description as string) ?? null,
  kind: r.kind as IRagCollection['kind'],
  isActive: Boolean(r.is_active),
});

const toDocument = (r: IRow): IRagDocument => ({
  id: String(r.id),
  collectionId: String(r.collection_id),
  sourceRef: String(r.source_ref),
  title: (r.title as string) ?? null,
  contentHash: String(r.content_hash),
  status: r.status as IRagDocumentStatus,
  chunkCount: Number(r.chunk_count),
  error: (r.error as string) ?? null,
  baseId: (r.base_id as string) ?? null,
  tableId: (r.table_id as string) ?? null,
  recordId: (r.record_id as string) ?? null,
});

/** What a chunk is found by, weighted: title and heading path (A) above the text (D). */
export function chunkHeading(title: string | null, headingPath: string | null) {
  // say the title once: a record's section is headed by it, a document's top heading often is
  const path = headingPath === title ? null : headingPath;
  return title && path?.startsWith(`${title} › `)
    ? path
    : [title, path].filter(Boolean).join(' › ');
}

/**
 * RagStorePort over the main PostgreSQL (design §11): schema agent_rag, created on first use,
 * searched with full-text search only.
 */
@Injectable()
export class PgRagStore implements IRagStorePort {
  private ready?: Promise<void>;

  constructor(private readonly prismaService: PrismaService) {}

  private async rows(
    db: IRaw,
    builder: { toSQL(): { toNative(): { sql: string; bindings: readonly unknown[] } } }
  ) {
    const { sql, bindings } = builder.toSQL().toNative();
    return db.$queryRawUnsafe<IRow[]>(sql, ...bindings);
  }

  /** The schema, created once per process. */
  private async db(): Promise<PrismaService> {
    this.ready ??= this.prismaService
      .$transaction(async (tx) => {
        // IF NOT EXISTS is not safe under concurrency (several replicas starting): serialize
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('agent_rag_schema'))`);
        for (const statement of RAG_SCHEMA_STATEMENTS) await tx.$executeRawUnsafe(statement);
      })
      .catch((error) => {
        this.ready = undefined;
        throw error;
      });
    await this.ready;
    return this.prismaService;
  }

  async listCollections() {
    const db = await this.db();
    return (await this.rows(db, qb(collectionTable).orderBy('id'))).map(toCollection);
  }

  async createCollection(input: Omit<IRagCollection, 'isActive'>) {
    const db = await this.db();
    const [row] = await this.rows(
      db,
      qb(collectionTable)
        .insert({
          id: input.id,
          label: input.label,
          description: input.description,
          kind: input.kind,
        })
        .returning('*')
    );
    return toCollection(row);
  }

  async deleteCollection(id: string) {
    const db = await this.db();
    await this.rows(db, qb(collectionTable).where({ id }).delete());
  }

  async upsertDocument(input: Omit<IRagDocument, 'id' | 'chunkCount' | 'error'>) {
    const db = await this.db();
    const id = documentIdFor(input.collectionId, input.sourceRef);
    const [row] = await this.rows(
      db,
      qb(documentTable)
        .insert({
          id,
          collection_id: input.collectionId,
          source_ref: input.sourceRef,
          title: input.title,
          content_hash: input.contentHash,
          status: input.status,
          base_id: input.baseId,
          table_id: input.tableId,
          record_id: input.recordId,
        })
        .onConflict('id')
        .merge({
          title: input.title,
          content_hash: input.contentHash,
          status: input.status,
          error: null,
          base_id: input.baseId,
          table_id: input.tableId,
          record_id: input.recordId,
          last_modified_time: qb.fn.now(),
        })
        .returning('*')
    );
    return toDocument(row);
  }

  async getDocument(id: string) {
    const db = await this.db();
    const [row] = await this.rows(db, qb(documentTable).where({ id }).limit(1));
    return row ? toDocument(row) : undefined;
  }

  async setDocumentStatus(id: string, status: IRagDocumentStatus, error: string | null = null) {
    const db = await this.db();
    await this.rows(
      db,
      qb(documentTable)
        .where({ id })
        .update({ status, error: error?.slice(0, 2000) ?? null, last_modified_time: qb.fn.now() })
    );
  }

  async deleteDocument(id: string) {
    const db = await this.db();
    await this.rows(db, qb(documentTable).where({ id }).delete());
  }

  async listDocuments(collectionId: string, limit = 100) {
    const db = await this.db();
    const rows = await this.rows(
      db,
      qb(documentTable)
        .where({ collection_id: collectionId })
        .orderBy('created_time', 'desc')
        .limit(Math.max(1, Math.min(limit, 100_000)))
    );
    return rows.map(toDocument);
  }

  async getDocuments(ids: string[]) {
    if (!ids.length) return [];
    const db = await this.db();
    return (await this.rows(db, qb(documentTable).whereIn('id', ids))).map(toDocument);
  }

  async deleteDocuments(ids: string[]) {
    if (!ids.length) return;
    const db = await this.db();
    await this.rows(db, qb(documentTable).whereIn('id', ids).delete());
  }

  async listTableDocuments(tableId: string, collectionIds: string[]) {
    const db = await this.db();
    const rows = await this.rows(
      db,
      qb(documentTable)
        .where({ table_id: tableId })
        .whereIn('collection_id', collectionIds)
        .whereNotNull('record_id')
    );
    return rows.map(toDocument);
  }

  async listIndexedTables(collectionIds: string[]) {
    const db = await this.db();
    const rows = await this.rows(
      db,
      qb(documentTable)
        .distinct('collection_id', 'table_id')
        .whereIn('collection_id', collectionIds)
        .whereNotNull('table_id')
    );
    return rows.map((r) => ({
      collectionId: String(r.collection_id),
      tableId: String(r.table_id),
    }));
  }

  async deleteTableDocuments(tableId: string, collectionIds: string[]) {
    const db = await this.db();
    const rows = await this.rows(
      db,
      qb(documentTable)
        .where({ table_id: tableId })
        .whereIn('collection_id', collectionIds)
        .delete()
        .returning('id')
    );
    return rows.length;
  }

  async getSyncState(tableId: string): Promise<ISyncState | undefined> {
    const db = await this.db();
    const [row] = await this.rows(db, qb(syncTable).where({ table_id: tableId }).limit(1));
    if (!row) return undefined;
    return {
      tableId: String(row.table_id),
      collectionId: (row.collection_id as string) ?? null,
      status: row.status as ISyncState['status'],
      records: Number(row.records),
      error: (row.error as string) ?? null,
      startedTime: (row.started_time as Date) ?? null,
      finishedTime: (row.finished_time as Date) ?? null,
    };
  }

  async setSyncState(tableId: string, patch: Partial<Omit<ISyncState, 'tableId'>>) {
    const db = await this.db();
    const values = {
      ...(patch.collectionId !== undefined ? { collection_id: patch.collectionId } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.records !== undefined ? { records: patch.records } : {}),
      ...(patch.error !== undefined ? { error: patch.error?.slice(0, 2000) ?? null } : {}),
      ...(patch.startedTime !== undefined ? { started_time: patch.startedTime } : {}),
      ...(patch.finishedTime !== undefined ? { finished_time: patch.finishedTime } : {}),
    };
    await this.rows(
      db,
      qb(syncTable)
        .insert({ table_id: tableId, status: patch.status ?? 'running', ...values })
        .onConflict('table_id')
        .merge(values)
    );
  }

  async replaceChunks(documentId: string, sections: IRagSection[]) {
    const db = await this.db();
    const doc = await this.getDocument(documentId);
    if (!doc) throw new Error(`No document ${documentId}`);
    const chunkCount = sections.reduce((n, s) => n + s.chunks.length, 0);
    return db.$transaction(async (tx) => {
      await this.rows(tx, qb(chunkTable).where({ document_id: documentId }).delete());
      let seq = 0;
      for (const section of sections) {
        const [parent] = await this.rows(
          tx,
          qb(chunkTable)
            .insert({
              document_id: documentId,
              collection_id: doc.collectionId,
              level: 0,
              seq: seq++,
              heading_path: section.headingPath,
              content: section.content,
            })
            .returning('id')
        );
        const heading = searchableText(chunkHeading(doc.title, section.headingPath));
        for (const text of section.chunks) {
          await this.rows(
            tx,
            qb(chunkTable).insert({
              document_id: documentId,
              collection_id: doc.collectionId,
              parent_id: parent.id,
              level: 1,
              seq: seq++,
              heading_path: section.headingPath,
              content: text,
              tsv: qb.raw(`setweight(to_tsvector('simple', ?), 'A') || to_tsvector('simple', ?)`, [
                heading,
                searchableText(text),
              ]),
            })
          );
        }
      }
      await this.rows(
        tx,
        qb(documentTable).where({ id: documentId }).update({
          status: 'ready',
          chunk_count: chunkCount,
          error: null,
          last_modified_time: qb.fn.now(),
        })
      );
      return chunkCount;
    });
  }

  async query(q: IRagQuery): Promise<IRagHit[]> {
    const built = buildSearchQuery(q);
    if (!built) return [];
    const db = await this.db();
    const rows = await this.rows(db, qb.raw(built.sql, built.bindings as never));
    return rows.map((r) => ({
      documentId: String(r.document_id),
      sectionId: Number(r.section_id),
      chunkId: Number(r.chunk_id),
      collectionId: String(r.collection_id),
      title: (r.title as string) ?? null,
      headingPath: (r.heading_path as string) ?? null,
      sourceRef: String(r.source_ref),
      recordId: (r.record_id as string) ?? null,
      baseId: (r.base_id as string) ?? null,
      tableId: (r.table_id as string) ?? null,
      chunk: String(r.chunk),
      section: String(r.section),
      score: Number(r.score),
    }));
  }

  async readSection(sectionId: number) {
    const db = await this.db();
    const [row] = await this.rows(
      db,
      qb(`${chunkTable} as c`)
        .join(`${documentTable} as d`, 'd.id', 'c.document_id')
        .where('c.id', sectionId)
        .andWhere('c.level', 0)
        .select('c.heading_path', 'c.content', 'd.title', 'd.id as document_id', 'd.source_ref')
        .limit(1)
    );
    return row
      ? {
          title: (row.title as string) ?? null,
          headingPath: (row.heading_path as string) ?? null,
          content: String(row.content),
          documentId: String(row.document_id),
          sourceRef: String(row.source_ref),
        }
      : undefined;
  }

  async readDocument(documentId: string, range: { from?: number; to?: number } = {}) {
    const db = await this.db();
    const doc = await this.getDocument(documentId);
    if (!doc) return undefined;
    const sections = await this.rows(
      db,
      qb(chunkTable)
        .where({ document_id: documentId, level: 0 })
        .orderBy('seq')
        .select('id', 'heading_path', 'content')
    );
    const from = Math.max(1, range.from ?? 1);
    const to = Math.min(sections.length, range.to ?? from + 9);
    return {
      title: doc.title,
      total: sections.length,
      sections: sections.slice(from - 1, to).map((s) => ({
        id: Number(s.id),
        headingPath: (s.heading_path as string) ?? null,
        content: String(s.content),
      })),
    };
  }
}

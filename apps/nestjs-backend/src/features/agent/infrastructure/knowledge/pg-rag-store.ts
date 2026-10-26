import { createHash } from 'crypto';
import { HttpErrorCode } from '@cybernetics/core';
import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import knex, { type Knex } from 'knex';
import { AgentConfig, type IAgentConfig } from '../../../../configs/agent.config';
import { CustomHttpException } from '../../../../custom.exception';
import type {
  IRagCollection,
  IRagDocument,
  IRagDocumentStatus,
  IRagEmbeddings,
  IRagHit,
  IRagQuery,
  IRagSection,
  IRagSpace,
  IRagSpaceStatus,
  IRagStorePort,
} from '../../domain/ports';
import { buildHybridQuery, toVectorLiteral } from './rag-query';
import {
  RAG_SCHEMA,
  RAG_SCHEMA_STATEMENTS,
  spaceSlug,
  spaceTable,
  spaceTableStatements,
} from './rag-schema';

export const documentIdFor = (collectionId: string, sourceRef: string) =>
  createHash('sha256').update(`${collectionId}:${sourceRef}`).digest('hex');

type IRow = Record<string, unknown>;

const toCollection = (r: IRow): IRagCollection => ({
  id: String(r.id),
  label: String(r.label),
  description: (r.description as string) ?? null,
  kind: r.kind as IRagCollection['kind'],
  minScore: r.min_score === null ? null : Number(r.min_score),
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

const toSpace = (r: IRow): IRagSpace => ({
  slug: String(r.slug),
  model: String(r.model),
  dimension: Number(r.dimension),
  status: r.status as IRagSpaceStatus,
});

/**
 * RagStorePort over the pgvector database (design §11): schema agent_rag, created on first use.
 * Connects lazily, so an app without knowledge search never opens the connection.
 */
@Injectable()
export class PgRagStore implements IRagStorePort, OnModuleDestroy {
  private readonly logger = new Logger(PgRagStore.name);
  private db?: Knex;
  private ready?: Promise<Knex>;
  private iterativeScan = false;

  constructor(@AgentConfig() private readonly config: IAgentConfig) {}

  async onModuleDestroy() {
    await this.db?.destroy();
  }

  /** The connection, with the schema in place. */
  private conn(): Promise<Knex> {
    if (!this.config.ragDatabaseUrl) {
      throw new CustomHttpException(
        'Knowledge search has no database. Set AGENT_RAG_DATABASE_URL (a PostgreSQL with pgvector).',
        HttpErrorCode.CONFLICT
      );
    }
    this.ready ??= (async () => {
      this.db = knex({
        client: 'pg',
        connection: this.config.ragDatabaseUrl,
        pool: { min: 0, max: 5 },
      });
      // IF NOT EXISTS is not safe under concurrency (several replicas starting): serialize
      await this.db.transaction(async (trx) => {
        await trx.raw(`SELECT pg_advisory_xact_lock(hashtext('agent_rag_schema'))`);
        for (const statement of RAG_SCHEMA_STATEMENTS) await trx.raw(statement);
      });
      const version = await this.db.raw(
        `SELECT extversion FROM pg_extension WHERE extname = 'vector'`
      );
      const [major, minor] = String(version.rows[0]?.extversion ?? '0.0')
        .split('.')
        .map(Number);
      // filtered HNSW search needs iterative scans (pgvector 0.8) to keep recall
      this.iterativeScan = major > 0 || minor >= 8;
      if (!this.iterativeScan)
        this.logger.warn('pgvector < 0.8: filtered vector search may miss rows');
      return this.db;
    })().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async listCollections() {
    const db = await this.conn();
    const rows = await db(`${RAG_SCHEMA}.collection`).orderBy('id');
    return rows.map(toCollection);
  }

  async createCollection(
    input: Omit<IRagCollection, 'isActive' | 'minScore'> & { minScore?: number | null }
  ) {
    const db = await this.conn();
    const [row] = await db(`${RAG_SCHEMA}.collection`)
      .insert({
        id: input.id,
        label: input.label,
        description: input.description,
        kind: input.kind,
        min_score: input.minScore ?? null,
      })
      .returning('*');
    return toCollection(row);
  }

  async deleteCollection(id: string) {
    const db = await this.conn();
    await db(`${RAG_SCHEMA}.collection`).where({ id }).delete();
  }

  async upsertDocument(input: Omit<IRagDocument, 'id' | 'chunkCount' | 'error'>) {
    const db = await this.conn();
    const id = documentIdFor(input.collectionId, input.sourceRef);
    const [row] = await db(`${RAG_SCHEMA}.document`)
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
        last_modified_time: db.fn.now(),
      })
      .returning('*');
    return toDocument(row);
  }

  async getDocument(id: string) {
    const db = await this.conn();
    const row = await db(`${RAG_SCHEMA}.document`).where({ id }).first();
    return row ? toDocument(row) : undefined;
  }

  async setDocumentStatus(id: string, status: IRagDocumentStatus, error: string | null = null) {
    const db = await this.conn();
    await db(`${RAG_SCHEMA}.document`)
      .where({ id })
      .update({ status, error: error?.slice(0, 2000) ?? null, last_modified_time: db.fn.now() });
  }

  async deleteDocument(id: string) {
    const db = await this.conn();
    await db(`${RAG_SCHEMA}.document`).where({ id }).delete();
  }

  async listDocuments(collectionId: string, limit = 100) {
    const db = await this.conn();
    const rows = await db(`${RAG_SCHEMA}.document`)
      .where({ collection_id: collectionId })
      .orderBy('created_time', 'desc')
      .limit(Math.min(limit, 1000));
    return rows.map(toDocument);
  }

  async replaceChunks(documentId: string, sections: IRagSection[], embeddings: IRagEmbeddings[]) {
    const db = await this.conn();
    const doc = await this.getDocument(documentId);
    if (!doc) throw new Error(`No document ${documentId}`);
    const chunkCount = sections.reduce((n, s) => n + s.chunks.length, 0);
    for (const e of embeddings) {
      if (e.vectors.length !== chunkCount) {
        throw new Error(`${e.space}: ${e.vectors.length} vectors for ${chunkCount} chunks`);
      }
    }
    return db.transaction(async (trx) => {
      // cascades to the chunks' vectors in every space
      await trx(`${RAG_SCHEMA}.chunk`).where({ document_id: documentId }).delete();
      let seq = 0;
      let flat = 0;
      for (const section of sections) {
        const [parent] = await trx(`${RAG_SCHEMA}.chunk`)
          .insert({
            document_id: documentId,
            collection_id: doc.collectionId,
            level: 0,
            seq: seq++,
            heading_path: section.headingPath,
            content: section.content,
          })
          .returning('id');
        for (const text of section.chunks) {
          const [chunk] = await trx(`${RAG_SCHEMA}.chunk`)
            .insert({
              document_id: documentId,
              collection_id: doc.collectionId,
              parent_id: parent.id,
              level: 1,
              seq: seq++,
              heading_path: section.headingPath,
              content: text,
            })
            .returning('id');
          for (const e of embeddings) {
            await trx.raw(
              `INSERT INTO ${spaceTable(e.space)} (chunk_id, collection_id, embedding) VALUES (?, ?, ?::vector)`,
              [chunk.id, doc.collectionId, toVectorLiteral(e.vectors[flat])]
            );
          }
          flat++;
        }
      }
      await trx(`${RAG_SCHEMA}.document`).where({ id: documentId }).update({
        status: 'ready',
        chunk_count: chunkCount,
        error: null,
        last_modified_time: trx.fn.now(),
      });
      return chunkCount;
    });
  }

  async hasAllEmbeddings(documentId: string, space: string) {
    const db = await this.conn();
    const result = await db.raw(
      `SELECT count(*)::int AS missing FROM ${RAG_SCHEMA}.chunk c
       LEFT JOIN ${spaceTable(space)} e ON e.chunk_id = c.id
       WHERE c.document_id = ? AND c.level = 1 AND e.chunk_id IS NULL`,
      [documentId]
    );
    return Number(result.rows[0].missing) === 0;
  }

  async listSpaces() {
    const db = await this.conn();
    return (await db(`${RAG_SCHEMA}.embedding_space`).orderBy('created_time')).map(toSpace);
  }

  async activeSpace() {
    const db = await this.conn();
    const row = await db(`${RAG_SCHEMA}.embedding_space`).where({ status: 'active' }).first();
    return row ? toSpace(row) : undefined;
  }

  async ensureSpace(model: string, dimension: number, status: IRagSpaceStatus) {
    const db = await this.conn();
    const slug = spaceSlug(model, dimension);
    await db.transaction(async (trx) => {
      await trx.raw(`SELECT pg_advisory_xact_lock(hashtext('agent_rag_schema'))`);
      for (const statement of spaceTableStatements(slug, dimension)) await trx.raw(statement);
    });
    // a retired space chosen again starts over as `status` (its old vectors are still valid)
    await db.raw(
      `INSERT INTO ${RAG_SCHEMA}.embedding_space (slug, model, dimension, status)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET status = excluded.status
       WHERE ${RAG_SCHEMA}.embedding_space.status = 'retired'`,
      [slug, model, dimension, status]
    );
    const row = await db(`${RAG_SCHEMA}.embedding_space`).where({ slug }).first();
    return toSpace(row);
  }

  async activateSpace(slug: string) {
    const db = await this.conn();
    await db.transaction(async (trx) => {
      await trx(`${RAG_SCHEMA}.embedding_space`)
        .where({ status: 'active' })
        .whereNot({ slug })
        .update({ status: 'retired' });
      await trx(`${RAG_SCHEMA}.embedding_space`).where({ slug }).update({ status: 'active' });
    });
  }

  async chunksWithoutEmbedding(space: string, limit: number) {
    const db = await this.conn();
    const result = await db.raw(
      `SELECT c.id, coalesce(d.title, '') AS title, c.heading_path, c.content
       FROM ${RAG_SCHEMA}.chunk c
       JOIN ${RAG_SCHEMA}.document d ON d.id = c.document_id
       LEFT JOIN ${spaceTable(space)} e ON e.chunk_id = c.id
       WHERE c.level = 1 AND e.chunk_id IS NULL
       ORDER BY c.id LIMIT ?`,
      [limit]
    );
    return (result.rows as IRow[]).map((r) => ({
      id: Number(r.id),
      text: embeddingText(r.title as string, r.heading_path as string | null, r.content as string),
    }));
  }

  async writeEmbeddings(space: string, rows: { chunkId: number; vector: number[] }[]) {
    if (!rows.length) return;
    const db = await this.conn();
    await db.transaction(async (trx) => {
      for (const row of rows) {
        await trx.raw(
          `INSERT INTO ${spaceTable(space)} (chunk_id, collection_id, embedding)
           SELECT id, collection_id, ?::vector FROM ${RAG_SCHEMA}.chunk WHERE id = ?
           ON CONFLICT (chunk_id) DO UPDATE SET embedding = excluded.embedding`,
          [toVectorLiteral(row.vector), row.chunkId]
        );
      }
    });
  }

  async query(q: IRagQuery): Promise<IRagHit[]> {
    if (!q.collections.length) return [];
    const db = await this.conn();
    const { sql, bindings } = buildHybridQuery(q);
    const rows = await db.transaction(async (trx) => {
      if (this.iterativeScan) await trx.raw(`SET LOCAL hnsw.iterative_scan = relaxed_order`);
      return (await trx.raw(sql, bindings as never)).rows as IRow[];
    });
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
      vectorRank: r.vector_rank === null ? null : Number(r.vector_rank),
      keywordRank: r.keyword_rank === null ? null : Number(r.keyword_rank),
    }));
  }

  async readSection(sectionId: number) {
    const db = await this.conn();
    const row = await db(`${RAG_SCHEMA}.chunk as c`)
      .join(`${RAG_SCHEMA}.document as d`, 'd.id', 'c.document_id')
      .where('c.id', sectionId)
      .andWhere('c.level', 0)
      .first('c.heading_path', 'c.content', 'd.title', 'd.id as document_id', 'd.source_ref');
    return row
      ? {
          title: row.title ?? null,
          headingPath: row.heading_path ?? null,
          content: row.content,
          documentId: row.document_id,
          sourceRef: row.source_ref,
        }
      : undefined;
  }

  async readDocument(documentId: string, range: { from?: number; to?: number } = {}) {
    const db = await this.conn();
    const doc = await this.getDocument(documentId);
    if (!doc) return undefined;
    const sections = await db(`${RAG_SCHEMA}.chunk`)
      .where({ document_id: documentId, level: 0 })
      .orderBy('seq')
      .select('id', 'heading_path', 'content');
    const from = Math.max(1, range.from ?? 1);
    const to = Math.min(sections.length, range.to ?? from + 9);
    return {
      title: doc.title,
      total: sections.length,
      sections: sections.slice(from - 1, to).map((s) => ({
        id: Number(s.id),
        headingPath: s.heading_path ?? null,
        content: s.content,
      })),
    };
  }
}

/** What gets embedded for a chunk (design §11.2 step 3): title › heading path, then the text. */
export function embeddingText(title: string | null, headingPath: string | null, content: string) {
  // a record's section is headed by its own title; say it once
  const path = headingPath === title ? null : headingPath;
  const prefix = [title, path].filter(Boolean).join(' › ');
  return prefix ? `${prefix}\n\n${content}` : content;
}

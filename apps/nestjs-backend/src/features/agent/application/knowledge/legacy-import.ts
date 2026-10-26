import { Inject, Injectable } from '@nestjs/common';
import type { IImportLegacyKnowledgeVo } from '@teable/openapi';
import {
  AUDIT_PORT,
  RAG_STORE_PORT,
  type IAuditPort,
  type IRagCollection,
  type IRagStorePort,
} from '../../domain/ports';
import {
  MastraLegacyReader,
  type ILegacyChunk,
  type ILegacyIndex,
} from '../../infrastructure/knowledge/mastra-legacy-reader';
import { KnowledgeIngest } from './knowledge-ingest';

type IIndexReport = IImportLegacyKnowledgeVo['indexes'][number];

/** Mastra chunked with 400 characters of overlap; allow some slack around it. */
const maxOverlap = 600;
/** Shorter matches are coincidences, not overlap. */
const minOverlap = 10;
const collectionSlug = /^[a-z][a-z0-9_]{1,40}$/;
/** Secrets are never embedded (design D4); this index is reported, not imported. */
const secretIndex = 'credential';

/** Join consecutive chunks back into the text, dropping each chunk's overlap with the previous. */
export function joinChunks(chunks: string[]): string {
  let out = chunks[0] ?? '';
  for (const next of chunks.slice(1)) {
    let k = Math.min(maxOverlap, out.length, next.length);
    while (k >= minOverlap && !out.endsWith(next.slice(0, k))) k--;
    out += k >= minOverlap ? next.slice(k) : `\n\n${next}`;
  }
  return out;
}

/** Chunks grouped by document (materialId), in order. */
export function documentsOf(chunks: ILegacyChunk[]) {
  const docs = new Map<string, { docName: string; texts: string[] }>();
  for (const c of chunks) {
    const doc = docs.get(c.materialId) ?? { docName: c.docName, texts: [] };
    doc.texts.push(c.text);
    docs.set(c.materialId, doc);
  }
  return [...docs.values()].map((d) => ({ docName: d.docName, text: joinChunks(d.texts) }));
}

/**
 * The one-off import of the old Mastra vectors (design §14.3): each index becomes a collection of
 * the same name and each document is rebuilt from its chunks, then re-chunked and re-embedded by
 * the normal ingest (source_ref `legacy:<index>/<docName>`). The Mastra schemas are left alone.
 */
@Injectable()
export class LegacyKnowledgeImport {
  constructor(
    private readonly reader: MastraLegacyReader,
    private readonly ingest: KnowledgeIngest,
    @Inject(RAG_STORE_PORT) private readonly rag: IRagStorePort,
    @Inject(AUDIT_PORT) private readonly audit: IAuditPort
  ) {}

  async run(input: { dryRun: boolean; actorUserId: string }): Promise<IImportLegacyKnowledgeVo> {
    const started = Date.now();
    const result = await this.reader.read(async (db) => {
      const indexes = await this.reader.indexes(db);
      const collections = new Map((await this.rag.listCollections()).map((c) => [c.id, c]));
      const reports: IIndexReport[] = [];
      let queued = 0;
      for (const index of indexes) {
        const chunks = index.hasTable ? await this.reader.chunks(db, index.name) : [];
        const report = await this.importIndex(index, chunks, collections, input);
        queued += report.queued;
        reports.push(report.report);
      }
      return { indexes: reports, queued };
    });
    const vo = {
      dryRun: input.dryRun,
      found: Boolean(result?.indexes.length),
      indexes: result?.indexes ?? [],
      queued: result?.queued ?? 0,
    };
    await this.audit.append({
      runId: 'admin',
      actorUserId: input.actorUserId,
      tool: 'knowledge.import_legacy',
      args: { dryRun: input.dryRun },
      resultSummary: vo.indexes.map((i) => `${i.index}:${i.outcome}:${i.documents}`).join(', '),
      status: 'ok',
      durationMs: Date.now() - started,
    });
    return vo;
  }

  private async importIndex(
    index: ILegacyIndex,
    chunks: ILegacyChunk[],
    collections: Map<string, IRagCollection>,
    input: { dryRun: boolean; actorUserId: string }
  ): Promise<{ report: IIndexReport; queued: number }> {
    const docs = documentsOf(chunks);
    const report: IIndexReport = {
      index: index.name,
      label: index.label,
      collection: null,
      documents: docs.length,
      chunks: chunks.length,
      outcome: 'empty',
      note: index.registered ? null : 'vector table without a registry row',
    };
    if (index.name === secretIndex) {
      return {
        report: {
          ...report,
          outcome: 'skipped_secret',
          note: `${chunks.length} vectors not imported: secrets are never embedded. Move them to agent credentials.`,
        },
        queued: 0,
      };
    }
    const existing = collections.get(index.name);
    if (!collectionSlug.test(index.name) || existing?.kind === 'derived') {
      return {
        report: {
          ...report,
          outcome: 'invalid_name',
          note: existing ? 'name of a synced collection' : 'not a valid collection id',
        },
        queued: 0,
      };
    }
    report.collection = index.name;
    if (input.dryRun) {
      return { report: { ...report, outcome: docs.length ? 'would_import' : 'empty' }, queued: 0 };
    }
    if (!existing) {
      const created = await this.rag.createCollection({
        id: index.name,
        label: index.label ?? index.name,
        description: index.description,
        kind: 'documents',
      });
      collections.set(created.id, created);
    }
    for (const doc of docs) {
      await this.ingest.request({
        collectionId: index.name,
        source: { kind: 'legacy', index: index.name, docName: doc.docName, text: doc.text },
        title: doc.docName,
        actorUserId: input.actorUserId,
        waitMs: 0,
      });
    }
    return {
      report: { ...report, outcome: docs.length ? 'imported' : 'empty' },
      queued: docs.length,
    };
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { rerank } from 'ai';
import {
  MODEL_PORT,
  RAG_STORE_PORT,
  type IModelPort,
  type IRagHit,
  type IRagStorePort,
} from '../../domain/ports';
import { EmbeddingSpaces } from './embedding-spaces';

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;
/** Fused candidates per search; the rerank pool (design §11.4). */
export const CANDIDATE_POOL = 40;
export const SNIPPET_MAX = 400;

export interface ISearchRequest {
  query: string;
  collections: string[];
  baseIds?: string[];
  tableIds?: string[];
  topK?: number;
  rerankModel?: string | null;
  /** Evaluation only: one pass instead of both (design §11.6). */
  mode?: 'hybrid' | 'keyword' | 'vector';
  abortSignal?: AbortSignal;
}

export interface ISearchResult {
  documentId: string;
  sectionId: number;
  collection: string;
  title: string | null;
  headingPath: string | null;
  snippet: string;
  sourceRef: string;
  recordRef?: { baseId: string; tableId: string; recordId: string };
  score: number;
}

/** About SNIPPET_MAX characters of the text around the first query term it contains. */
export function snippetOf(text: string, query: string, max = SNIPPET_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const lower = clean.toLowerCase();
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const at = terms
    .map((t) => lower.indexOf(t))
    .filter((i) => i >= 0)
    .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
  const body = max - 2;
  const start = Number.isFinite(at)
    ? Math.max(0, Math.min(at - Math.floor(body / 3), clean.length - body))
    : 0;
  const end = start + body;
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

/** Small to big: two chunks of one section count once, at the better rank. */
export function bySection(hits: IRagHit[]): IRagHit[] {
  const seen = new Set<number>();
  return hits.filter((h) => !seen.has(h.sectionId) && seen.add(h.sectionId));
}

const toResult = (h: IRagHit, query: string, score: number): ISearchResult => ({
  documentId: h.documentId,
  sectionId: h.sectionId,
  collection: h.collectionId,
  title: h.title,
  headingPath: h.headingPath,
  snippet: snippetOf(h.chunk, query),
  sourceRef: h.sourceRef,
  ...(h.recordId && h.baseId && h.tableId
    ? { recordRef: { baseId: h.baseId, tableId: h.tableId, recordId: h.recordId } }
    : {}),
  score: Math.round(score * 10_000) / 10_000,
});

/**
 * Hybrid search (design §11.4): keyword and vector passes fused in one statement, 40 candidates,
 * an optional reranker over them, grouped by section, snippets out. Says what was searched, how,
 * and what failed, instead of hiding it.
 */
@Injectable()
export class KnowledgeSearch {
  private readonly logger = new Logger(KnowledgeSearch.name);

  constructor(
    @Inject(RAG_STORE_PORT) private readonly rag: IRagStorePort,
    @Inject(MODEL_PORT) private readonly models: IModelPort,
    private readonly spaces: EmbeddingSpaces
  ) {}

  async search(req: ISearchRequest) {
    const topK = Math.min(Math.max(req.topK ?? DEFAULT_TOP_K, 1), MAX_TOP_K);
    const known = new Map((await this.rag.listCollections()).map((c) => [c.id, c]));
    const searched = req.collections.filter((c) => known.get(c)?.isActive);
    const failed: { collection: string; error: string }[] = req.collections
      .filter((c) => !known.get(c)?.isActive)
      .map((c) => ({
        collection: c,
        error: known.has(c) ? 'collection is switched off' : 'no such collection',
      }));
    const warnings: string[] = [];
    if (!searched.length) return { searched, failed, mode: 'none', warnings, results: [] };

    const { vector, space } =
      req.mode === 'keyword' ? {} : await this.queryVector(req.query, warnings);
    const hits = await this.rag.query({
      text: req.query,
      collections: searched,
      vector,
      space,
      baseIds: req.baseIds,
      tableIds: req.tableIds,
      pool: CANDIDATE_POOL,
      mode: req.mode,
    });
    const ranked = await this.rerank(req, hits, warnings);
    const results = bySection(ranked.map((r) => r.hit))
      .slice(0, topK)
      .map((h) => toResult(h, req.query, ranked.find((r) => r.hit === h)!.score));
    return {
      searched,
      failed,
      mode: `${req.mode === 'vector' ? 'vector' : vector ? 'hybrid' : 'keyword'}${ranked.reranked ? '+rerank' : ''}`,
      warnings,
      results,
    };
  }

  /** The query in the active space; without one (or if it fails), keyword search only. */
  private async queryVector(query: string, warnings: string[]) {
    const active = await this.rag.activeSpace();
    if (!active) {
      warnings.push('No embedding model is active yet: keyword matches only.');
      return {};
    }
    try {
      const [vector] = await this.spaces.embed(active.model, [query]);
      return { vector, space: active.slug };
    } catch (error) {
      this.logger.warn(`query embedding failed: ${(error as Error).message}`);
      warnings.push(
        `The embedding model failed (${(error as Error).message}): keyword matches only.`
      );
      return {};
    }
  }

  private async rerank(req: ISearchRequest, hits: IRagHit[], warnings: string[]) {
    const plain = Object.assign(
      hits.map((hit) => ({ hit, score: hit.score })),
      { reranked: false }
    );
    if (!req.rerankModel || hits.length < 2) return plain;
    try {
      const { model } = await this.models.reranker(req.rerankModel);
      const { ranking } = await rerank({
        model,
        query: req.query,
        documents: hits.map((h) => [h.title, h.headingPath, h.chunk].filter(Boolean).join('\n')),
        abortSignal: req.abortSignal,
      });
      return Object.assign(
        ranking.map((r) => ({ hit: hits[r.originalIndex], score: r.score })),
        { reranked: true }
      );
    } catch (error) {
      this.logger.warn(`rerank failed: ${(error as Error).message}`);
      warnings.push(`The reranker failed (${(error as Error).message}): fused order kept.`);
      return plain;
    }
  }
}

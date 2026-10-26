import { Inject, Injectable } from '@nestjs/common';
import { RAG_STORE_PORT, type IRagHit, type IRagStorePort } from '../../domain/ports';

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;
/** Candidate chunks per search, before grouping by section. */
export const CANDIDATE_POOL = 40;
export const SNIPPET_MAX = 400;

export interface ISearchRequest {
  query: string;
  collections: string[];
  baseIds?: string[];
  tableIds?: string[];
  topK?: number;
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

const toResult = (h: IRagHit, query: string): ISearchResult => ({
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
  score: Math.round(h.score * 10_000) / 10_000,
});

/**
 * Full-text search (design §11.4): matching chunks ranked by PostgreSQL text search, grouped by
 * section, snippets out. Says what was searched and what failed, instead of hiding it.
 */
@Injectable()
export class KnowledgeSearch {
  constructor(@Inject(RAG_STORE_PORT) private readonly rag: IRagStorePort) {}

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
    if (!searched.length) return { searched, failed, warnings, results: [] };

    const hits = await this.rag.query({
      text: req.query,
      collections: searched,
      baseIds: req.baseIds,
      tableIds: req.tableIds,
      pool: CANDIDATE_POOL,
    });
    const results = bySection(hits)
      .slice(0, topK)
      .map((h) => toResult(h, req.query));
    return { searched, failed, warnings, results };
  }
}

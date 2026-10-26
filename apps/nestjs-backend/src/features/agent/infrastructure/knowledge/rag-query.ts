import type { IRagQuery } from '../../domain/ports';
import { RAG_SCHEMA, spaceTable } from './rag-schema';

export const RRF_K = 60;
export const DEFAULT_POOL = 40;

export const toVectorLiteral = (v: number[]) =>
  `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;

/**
 * Hybrid retrieval in one statement (design §11.4): a vector pass and a keyword pass over level-1
 * chunks, fused with Reciprocal Rank Fusion (k = 60), joined to the parent section and document.
 * Returns SQL and its bindings (knex `?` placeholders); nothing user-supplied is spliced in.
 */
export function buildHybridQuery(q: IRagQuery): { sql: string; bindings: unknown[] } {
  const pool = Math.min(Math.max(q.pool ?? DEFAULT_POOL, 1), 200);
  const mode = q.mode ?? 'hybrid';
  const useVector = mode !== 'keyword' && q.vector && q.space;
  const useKeyword = mode !== 'vector';
  const bindings: unknown[] = [];

  const docFilter = (alias: string) => {
    const parts: string[] = [];
    if (q.baseIds?.length) {
      parts.push(`${alias}.base_id = ANY(?)`);
      bindings.push(q.baseIds);
    }
    if (q.tableIds?.length) {
      parts.push(`${alias}.table_id = ANY(?)`);
      bindings.push(q.tableIds);
    }
    return parts.length ? ` AND ${parts.join(' AND ')}` : '';
  };

  const passes: string[] = [];
  let vecCte = '';
  if (useVector) {
    const table = spaceTable(q.space!);
    bindings.push(toVectorLiteral(q.vector!), q.collections);
    const filter = docFilter('vd');
    bindings.push(toVectorLiteral(q.vector!), pool);
    vecCte = `vec AS (
      SELECT e.chunk_id, row_number() OVER (ORDER BY e.embedding <=> ?::vector) AS r
      FROM ${table} e
      JOIN ${RAG_SCHEMA}.chunk vc ON vc.id = e.chunk_id
      JOIN ${RAG_SCHEMA}.document vd ON vd.id = vc.document_id
      WHERE e.collection_id = ANY(?)${filter}
      ORDER BY e.embedding <=> ?::vector LIMIT ?)`;
    passes.push(`SELECT chunk_id, r, 'v' AS pass FROM vec`);
  }
  let kwCte = '';
  if (useKeyword) {
    bindings.push(q.text, q.collections, q.text);
    const filter = docFilter('kd');
    bindings.push(q.text, pool);
    kwCte = `kw AS (
      SELECT c.id AS chunk_id,
             row_number() OVER (ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('simple', ?)) DESC) AS r
      FROM ${RAG_SCHEMA}.chunk c
      JOIN ${RAG_SCHEMA}.document kd ON kd.id = c.document_id
      WHERE c.level = 1 AND c.collection_id = ANY(?) AND c.tsv @@ websearch_to_tsquery('simple', ?)${filter}
      ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('simple', ?)) DESC LIMIT ?)`;
    passes.push(`SELECT chunk_id, r, 'k' AS pass FROM kw`);
  }
  if (!passes.length) return { sql: 'SELECT 1 WHERE false', bindings: [] };

  bindings.push(pool);
  const ctes = [vecCte, kwCte].filter(Boolean).join(',\n');
  const sql = `WITH ${ctes},
    fused AS (
      SELECT chunk_id,
             sum(1.0 / (${RRF_K} + r)) AS score,
             min(r) FILTER (WHERE pass = 'v') AS vector_rank,
             min(r) FILTER (WHERE pass = 'k') AS keyword_rank
      FROM (${passes.join(' UNION ALL ')}) u
      GROUP BY chunk_id)
    SELECT f.score, f.vector_rank, f.keyword_rank,
           c.id AS chunk_id, c.content AS chunk, c.collection_id,
           p.id AS section_id, p.content AS section, p.heading_path,
           d.id AS document_id, d.title, d.source_ref, d.record_id, d.base_id, d.table_id
    FROM fused f
    JOIN ${RAG_SCHEMA}.chunk c ON c.id = f.chunk_id
    JOIN ${RAG_SCHEMA}.chunk p ON p.id = c.parent_id
    JOIN ${RAG_SCHEMA}.document d ON d.id = c.document_id
    ORDER BY f.score DESC, c.id
    LIMIT ?`;
  return { sql, bindings };
}

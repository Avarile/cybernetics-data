import type { IRagQuery } from '../../domain/ports';
import { RAG_SCHEMA } from './rag-schema';

export const DEFAULT_POOL = 40;
/** At most this many terms go into one query. */
const maxTerms = 32;

/** Words that say nothing about a topic; a question's search leaves them out. */
const stopwords = new Set(
  (
    'a an and are as at be but by can could did do does for from had has have how i if in into is ' +
    'it its me my no not of on or our please so that the their them there these they this to was ' +
    'we were what when where which who whom why will with would you your about after before ' +
    'should any all some just than then too very also get got need want tell show find'
  ).split(' ')
);

const cjkRun = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

/** Character pairs of each CJK run ("春节值班" → 春节 节值 值班); a lone character stays. */
export function cjkBigrams(text: string): string[] {
  const out: string[] = [];
  for (const run of text.match(cjkRun) ?? []) {
    const chars = [...run];
    if (chars.length === 1) out.push(run);
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
  }
  return out;
}

/**
 * Text as indexed: the 'simple' parser keeps a CJK run as one token, so its character pairs are
 * appended to make Chinese and Japanese text findable by any part of a phrase.
 */
export function searchableText(text: string): string {
  const pairs = cjkBigrams(text);
  return pairs.length ? `${text} ${pairs.join(' ')}` : text;
}

export interface ISearchTerms {
  /** Each term is matched on its own; a chunk ranks by how many it contains. */
  terms: string[];
  /** The last word, matched as a prefix ("kube" finds "kubernetes"). */
  prefix: string | null;
  /** Quoted input: websearch syntax (phrases, -exclusions) is used as is. */
  websearch: string | null;
}

/**
 * The search terms of a question: its meaningful words (stopwords dropped) and the character
 * pairs of its CJK runs. The last word also matches as a prefix while it is being typed.
 */
export function searchTerms(text: string): ISearchTerms {
  if (text.includes('"')) return { terms: [], prefix: null, websearch: text };
  const lower = text.toLowerCase();
  const words = (
    lower.replace(cjkRun, ' ').match(/[\p{L}\p{N}](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}])?/gu) ?? []
  ).filter((t) => t.length > 1 || /\p{N}/u.test(t));
  const meaningful = words.filter((t) => !stopwords.has(t));
  const terms = [...new Set([...(meaningful.length ? meaningful : words), ...cjkBigrams(lower)])];
  const last = meaningful.at(-1);
  const prefix =
    last && /^[\p{L}\p{N}]{3,}$/u.test(last) && !/\s$/.test(text) && lower.trimEnd().endsWith(last)
      ? last
      : null;
  return { terms: terms.slice(0, maxTerms), prefix, websearch: null };
}

/** The tsquery expression for the terms, with its bindings. Null when nothing is searchable. */
function tsqueryOf(t: ISearchTerms): { sql: string; bindings: unknown[] } | null {
  if (t.websearch) return { sql: `websearch_to_tsquery('simple', ?)`, bindings: [t.websearch] };
  const parts = t.terms.map(() => `plainto_tsquery('simple', ?)`);
  const bindings: unknown[] = [...t.terms];
  if (t.prefix) {
    parts.push(`to_tsquery('simple', ?)`);
    bindings.push(`${t.prefix}:*`);
  }
  return parts.length ? { sql: parts.join(' || '), bindings } : null;
}

/**
 * Full-text retrieval in one statement (design §11.4): level-1 chunks matching any term, ranked
 * by cover density with titles and headings weighted above the text, joined to their section
 * and document. Returns SQL and its bindings (knex `?` placeholders); nothing user-supplied is
 * spliced in.
 */
export function buildSearchQuery(q: IRagQuery): { sql: string; bindings: unknown[] } | null {
  const ts = tsqueryOf(searchTerms(q.text));
  if (!ts || !q.collections.length) return null;
  const pool = Math.min(Math.max(q.pool ?? DEFAULT_POOL, 1), 200);
  const bindings: unknown[] = [...ts.bindings, q.collections];
  const filters: string[] = [];
  if (q.baseIds?.length) {
    filters.push(`d.base_id = ANY(?)`);
    bindings.push(q.baseIds);
  }
  if (q.tableIds?.length) {
    filters.push(`d.table_id = ANY(?)`);
    bindings.push(q.tableIds);
  }
  bindings.push(pool);
  const sql = `WITH q AS (SELECT (${ts.sql}) AS q)
    SELECT ts_rank_cd(c.tsv, q.q) AS score,
           c.id AS chunk_id, c.content AS chunk, c.collection_id,
           p.id AS section_id, p.content AS section, p.heading_path,
           d.id AS document_id, d.title, d.source_ref, d.record_id, d.base_id, d.table_id
    FROM ${RAG_SCHEMA}.chunk c
    CROSS JOIN q
    JOIN ${RAG_SCHEMA}.chunk p ON p.id = c.parent_id
    JOIN ${RAG_SCHEMA}.document d ON d.id = c.document_id
    WHERE c.level = 1 AND c.collection_id = ANY(?) AND c.tsv @@ q.q${
      filters.length ? ` AND ${filters.join(' AND ')}` : ''
    }
    ORDER BY score DESC, c.id
    LIMIT ?`;
  return { sql, bindings };
}

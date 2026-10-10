import { createTool } from '@mastra/core/tools';
import type { VectorFilter } from '@mastra/core/vector';
import { z } from 'zod';
import { listIndexes, getIndex } from '../../db/db-vector.js';
import { queryVectors, queryMultiIndex, type IndexName } from '../../rag/vector-db.js';

// Converts a simple key-value filter map into a VectorFilter.
// Array values become $in (any-of) checks; scalar values become equality checks.
function buildFilter(
  filter?: Record<string, string | number | boolean | string[]>
): VectorFilter | undefined {
  if (!filter || Object.keys(filter).length === 0) return undefined;
  const conditions = Object.entries(filter).map(([key, value]) =>
    Array.isArray(value) ? { [key]: { $in: value } } : { [key]: value }
  );
  if (conditions.length === 1) return conditions[0] as VectorFilter;
  return { $and: conditions } as VectorFilter;
}

const hitSchema = z.object({
  id: z.string(),
  score: z.number(),
  text: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

const filterSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
  .optional()
  .describe(
    'Metadata filter as key-value pairs. ' +
      'A string, number, or boolean value means equality match. ' +
      'An array of strings means any-of match ($in). ' +
      'Example: { source: "report-2024", tags: ["finance", "ma"] }'
  );

// ─────────────────────────────────────────────
// Tool: vector-query
// General-purpose semantic search over a single index with reranking.
// The indexName is validated at runtime against the embedding_index table.
// ─────────────────────────────────────────────
export const vectorQueryTool = createTool({
  id: 'vector-query',
  description:
    'Semantically search a single knowledge index and return reranked results. ' +
    'Use list-indexes to discover available index names before calling this tool. ' +
    'Results include matched text and full metadata. ' +
    'Use all-knowledge-query when the relevant index is unknown.',
  inputSchema: z.object({
    indexName: z
      .string()
      .describe('Index name to search — must be an active index from list-indexes'),
    query: z.string().describe('Natural language question or search phrase'),
    topK: z.number().int().min(1).max(20).optional().default(5),
    minScore: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Drop results below this similarity score (0–1, default: no cutoff)'),
    filter: filterSchema,
  }),
  outputSchema: z.object({
    results: z.array(hitSchema),
    totalFound: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ indexName, query, topK, minScore, filter }) => {
    try {
      const ix = await getIndex(indexName);
      if (!ix) return { results: [], totalFound: 0, error: `Index "${indexName}" not found` };
      if (!ix.is_active)
        return { results: [], totalFound: 0, error: `Index "${indexName}" is inactive` };

      const hits = await queryVectors(ix.name, query, {
        topK,
        minScore,
        filter: buildFilter(filter),
      });

      return {
        results: hits.map((h) => ({
          id: h.id,
          score: h.score,
          text: h.text,
          metadata: h.metadata,
        })),
        totalFound: hits.length,
      };
    } catch (err) {
      return {
        results: [],
        totalFound: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ─────────────────────────────────────────────
// Tool: all-knowledge-query
// Fan-out search across multiple indexes in one call.
// When no indexes are specified, fetches all active indexes from the DB.
// ─────────────────────────────────────────────
export const allKnowledgeQueryTool = createTool({
  id: 'all-knowledge-query',
  description:
    'Search across multiple knowledge indexes in one call. ' +
    'The query is embedded once and sent in parallel to each selected index. ' +
    'Results are merged and reranked as a single list with an indexName field on each hit. ' +
    'When indexes is omitted, all active indexes are searched. ' +
    'Use vector-query for faster single-index search when you know the domain.',
  inputSchema: z.object({
    query: z.string().describe('Natural language question or search phrase'),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(6)
      .describe('Total results to return across all indexes (default: 6)'),
    minScore: z.number().min(0).max(1).optional(),
    indexes: z
      .array(z.string())
      .min(1)
      .optional()
      .describe('Index names to search. Defaults to all active indexes.'),
  }),
  outputSchema: z.object({
    results: z.array(hitSchema.extend({ indexName: z.string() })),
    totalFound: z.number(),
    indexesSearched: z.array(z.string()),
    error: z.string().optional(),
  }),
  execute: async ({ query, topK, minScore, indexes }) => {
    try {
      let targets: string[];
      if (indexes && indexes.length > 0) {
        targets = indexes;
      } else {
        const active = await listIndexes();
        targets = active.map((ix) => ix.name);
      }

      if (targets.length === 0) {
        return {
          results: [],
          totalFound: 0,
          indexesSearched: [],
          error:
            'No active indexes found. Create one with create-index, then ingest content with ingest-document or synthesize-and-ingest.',
        };
      }

      const hits = await queryMultiIndex(targets, query, { topK, minScore });

      return {
        results: hits.map((h) => ({
          id: h.id,
          score: h.score,
          text: h.text,
          indexName: h.indexName,
          metadata: h.metadata,
        })),
        totalFound: hits.length,
        indexesSearched: targets,
      };
    } catch (err) {
      return {
        results: [],
        totalFound: 0,
        indexesSearched: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

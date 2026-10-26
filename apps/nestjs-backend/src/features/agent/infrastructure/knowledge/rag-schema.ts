/**
 * The agent_rag schema (design §11.1). Every statement is idempotent; it runs once per process,
 * on first use of the store (never at boot).
 */
export const RAG_SCHEMA = 'agent_rag';

export const RAG_SCHEMA_STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE SCHEMA IF NOT EXISTS ${RAG_SCHEMA}`,
  `CREATE TABLE IF NOT EXISTS ${RAG_SCHEMA}.collection (
    id text PRIMARY KEY,
    label text NOT NULL,
    description text,
    kind text NOT NULL,
    min_score real,
    is_active boolean NOT NULL DEFAULT true,
    created_time timestamptz NOT NULL DEFAULT now(),
    last_modified_time timestamptz)`,
  `CREATE TABLE IF NOT EXISTS ${RAG_SCHEMA}.document (
    id text PRIMARY KEY,
    collection_id text NOT NULL REFERENCES ${RAG_SCHEMA}.collection ON DELETE CASCADE,
    source_ref text NOT NULL,
    title text,
    content_hash text NOT NULL,
    status text NOT NULL,
    chunk_count int NOT NULL DEFAULT 0,
    error text,
    base_id text, table_id text, record_id text,
    created_time timestamptz NOT NULL DEFAULT now(),
    last_modified_time timestamptz,
    UNIQUE (collection_id, source_ref))`,
  `CREATE INDEX IF NOT EXISTS document_base_table_idx ON ${RAG_SCHEMA}.document (base_id, table_id)`,
  `CREATE TABLE IF NOT EXISTS ${RAG_SCHEMA}.chunk (
    id bigserial PRIMARY KEY,
    document_id text NOT NULL REFERENCES ${RAG_SCHEMA}.document ON DELETE CASCADE,
    collection_id text NOT NULL,
    parent_id bigint REFERENCES ${RAG_SCHEMA}.chunk ON DELETE CASCADE,
    level smallint NOT NULL,
    seq int NOT NULL,
    heading_path text,
    content text NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(heading_path, '') || ' ' || content)) STORED)`,
  `CREATE INDEX IF NOT EXISTS chunk_tsv_idx ON ${RAG_SCHEMA}.chunk USING gin (tsv) WHERE level = 1`,
  `CREATE INDEX IF NOT EXISTS chunk_document_idx ON ${RAG_SCHEMA}.chunk (document_id)`,
  `CREATE INDEX IF NOT EXISTS chunk_collection_level_idx ON ${RAG_SCHEMA}.chunk (collection_id, level)`,
  `CREATE TABLE IF NOT EXISTS ${RAG_SCHEMA}.embedding_space (
    slug text PRIMARY KEY,
    model text NOT NULL,
    dimension int NOT NULL,
    status text NOT NULL,
    created_time timestamptz NOT NULL DEFAULT now())`,
  // when a space was retired; its table is dropped some days later (design §11.5)
  `ALTER TABLE ${RAG_SCHEMA}.embedding_space ADD COLUMN IF NOT EXISTS retired_time timestamptz`,
  // design §11.1: kb_records and agent_memory are synced from tables; knowledge is for documents
  `INSERT INTO ${RAG_SCHEMA}.collection (id, label, description, kind) VALUES
    ('knowledge', 'Knowledge', 'Documents the admin or the agent added', 'documents'),
    ('kb_records', 'Knowledge tables', 'Records of knowledge tables, kept in sync', 'derived'),
    ('agent_memory', 'Agent memory', 'The agent memory table, kept in sync', 'derived')
    ON CONFLICT (id) DO NOTHING`,
];

/** `openai-text-embedding-3-small` + 1536 → `openai_text_embedding_3_small_1536` (≤ 48 chars). */
export function spaceSlug(model: string, dimension: number) {
  const base = model
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${base || 'model'}_${dimension}`;
}

/** The table of a space; the slug is ours (never user input), checked again here. */
export function spaceTable(slug: string) {
  if (!/^[a-z0-9_]{1,60}$/.test(slug)) throw new Error(`Bad embedding space slug: ${slug}`);
  return `${RAG_SCHEMA}.embedding_${slug}`;
}

export const spaceTableStatements = (slug: string, dimension: number) => {
  const table = spaceTable(slug);
  return [
    `CREATE TABLE IF NOT EXISTS ${table} (
      chunk_id bigint PRIMARY KEY REFERENCES ${RAG_SCHEMA}.chunk ON DELETE CASCADE,
      collection_id text NOT NULL,
      embedding vector(${Number(dimension)}) NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS embedding_${slug}_hnsw ON ${table} USING hnsw (embedding vector_cosine_ops)`,
    `CREATE INDEX IF NOT EXISTS embedding_${slug}_collection ON ${table} (collection_id)`,
  ];
};

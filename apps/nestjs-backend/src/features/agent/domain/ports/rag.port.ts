/* eslint-disable @typescript-eslint/naming-convention */

/** Knowledge storage (design §11): collections, documents, sectioned chunks, embedding spaces. */

export type IRagCollectionKind = 'documents' | 'derived';
export type IRagDocumentStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type IRagSpaceStatus = 'building' | 'active' | 'retired';

export interface IRagCollection {
  id: string;
  label: string;
  description: string | null;
  kind: IRagCollectionKind;
  minScore: number | null;
  isActive: boolean;
}

export interface IRagDocument {
  id: string;
  collectionId: string;
  sourceRef: string;
  title: string | null;
  contentHash: string;
  status: IRagDocumentStatus;
  chunkCount: number;
  error: string | null;
  baseId: string | null;
  tableId: string | null;
  recordId: string | null;
}

export interface IRagSpace {
  slug: string;
  model: string;
  dimension: number;
  status: IRagSpaceStatus;
  retiredAt: string | null;
}

/** A section (what is returned) with its chunks (what is searched). */
export interface IRagSection {
  headingPath: string | null;
  content: string;
  chunks: string[];
}

/** Vectors for the chunks of a replace, in section/chunk order, per embedding space. */
export interface IRagEmbeddings {
  space: string;
  vectors: number[][];
}

export interface IRagHit {
  documentId: string;
  sectionId: number;
  chunkId: number;
  collectionId: string;
  title: string | null;
  headingPath: string | null;
  sourceRef: string;
  recordId: string | null;
  baseId: string | null;
  tableId: string | null;
  chunk: string;
  section: string;
  score: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

export interface IRagQuery {
  text: string;
  collections: string[];
  /** Query vector in the active space; without it, the keyword pass only. */
  vector?: number[];
  space?: string;
  baseIds?: string[];
  tableIds?: string[];
  /** Candidates per pass (design §11.4: 40). */
  pool?: number;
  mode?: 'hybrid' | 'keyword' | 'vector';
}

export interface IRagStorePort {
  listCollections(): Promise<IRagCollection[]>;
  createCollection(
    input: Omit<IRagCollection, 'isActive' | 'minScore'> & { minScore?: number | null }
  ): Promise<IRagCollection>;
  deleteCollection(id: string): Promise<void>;

  /** Insert or update by (collection, sourceRef); the id is derived from both. */
  upsertDocument(input: Omit<IRagDocument, 'id' | 'chunkCount' | 'error'>): Promise<IRagDocument>;
  getDocument(id: string): Promise<IRagDocument | undefined>;
  setDocumentStatus(id: string, status: IRagDocumentStatus, error?: string | null): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  listDocuments(collectionId: string, limit?: number): Promise<IRagDocument[]>;

  /** One transaction: drop the old chunks (and their vectors), write the new ones, mark ready. */
  replaceChunks(
    documentId: string,
    sections: IRagSection[],
    embeddings: IRagEmbeddings[]
  ): Promise<number>;
  /** True when every level-1 chunk of the document has a vector in the space. */
  hasAllEmbeddings(documentId: string, space: string): Promise<boolean>;

  listSpaces(): Promise<IRagSpace[]>;
  activeSpace(): Promise<IRagSpace | undefined>;
  /** Create the space and its table if needed; a retired space is revived with `status`. */
  ensureSpace(model: string, dimension: number, status: IRagSpaceStatus): Promise<IRagSpace>;
  /** Make one space active; the previous active one is retired. */
  activateSpace(slug: string): Promise<void>;
  /** Drop the tables of spaces retired before the date; returns their slugs. */
  dropRetiredSpaces(retiredBefore: Date): Promise<string[]>;
  /** Level-1 chunks without a vector in the space, for backfills. */
  chunksWithoutEmbedding(space: string, limit: number): Promise<{ id: number; text: string }[]>;
  writeEmbeddings(space: string, rows: { chunkId: number; vector: number[] }[]): Promise<void>;

  query(q: IRagQuery): Promise<IRagHit[]>;
  readSection(sectionId: number): Promise<
    | {
        title: string | null;
        headingPath: string | null;
        content: string;
        documentId: string;
        sourceRef: string;
      }
    | undefined
  >;
  readDocument(
    documentId: string,
    range?: { from?: number; to?: number }
  ): Promise<
    | {
        title: string | null;
        sections: { id: number; headingPath: string | null; content: string }[];
        total: number;
      }
    | undefined
  >;
}

export const RAG_STORE_PORT = Symbol('AGENT_RAG_STORE_PORT');

/** Where a document's text comes from (design §11.3); the source ref is derived from it. */
export type IRagSource =
  | { kind: 'text'; text: string; slug?: string }
  | { kind: 'attachment'; token: string }
  | { kind: 'url'; url: string }
  | { kind: 'record'; baseId: string; tableId: string; recordId: string }
  /** A document rebuilt from the old Mastra vectors (design §14.3). */
  | { kind: 'legacy'; index: string; docName: string; text: string };

export interface IRagSourceText {
  title: string | null;
  /** For a record, its body (context or content); the title is kept apart. */
  text: string;
  format: 'markdown' | 'text' | 'record';
}

export interface IRagSourceReaderPort {
  /** Undefined when the source is gone (a deleted record, a forgotten memory). */
  read(source: IRagSource): Promise<IRagSourceText | undefined>;
}

export const RAG_SOURCE_READER_PORT = Symbol('AGENT_RAG_SOURCE_READER_PORT');

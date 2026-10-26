/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Knowledge storage (design §11): collections, documents and sectioned chunks in the main
 * PostgreSQL, searched with full-text search only.
 */

export type IRagCollectionKind = 'documents' | 'derived';
export type IRagDocumentStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface IRagCollection {
  id: string;
  label: string;
  description: string | null;
  kind: IRagCollectionKind;
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

/** A section (what is returned) with its chunks (what is searched). */
export interface IRagSection {
  headingPath: string | null;
  content: string;
  chunks: string[];
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
}

export interface IRagQuery {
  text: string;
  collections: string[];
  baseIds?: string[];
  tableIds?: string[];
  /** Candidate chunks before grouping by section (default 40). */
  pool?: number;
}

export interface IRagStorePort {
  listCollections(): Promise<IRagCollection[]>;
  createCollection(input: Omit<IRagCollection, 'isActive'>): Promise<IRagCollection>;
  deleteCollection(id: string): Promise<void>;

  /** Insert or update by (collection, sourceRef); the id is derived from both. */
  upsertDocument(input: Omit<IRagDocument, 'id' | 'chunkCount' | 'error'>): Promise<IRagDocument>;
  getDocument(id: string): Promise<IRagDocument | undefined>;
  setDocumentStatus(id: string, status: IRagDocumentStatus, error?: string | null): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  listDocuments(collectionId: string, limit?: number): Promise<IRagDocument[]>;

  /** One transaction: drop the old chunks, write the new ones, mark the document ready. */
  replaceChunks(documentId: string, sections: IRagSection[]): Promise<number>;

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
  | { kind: 'record'; baseId: string; tableId: string; recordId: string };

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

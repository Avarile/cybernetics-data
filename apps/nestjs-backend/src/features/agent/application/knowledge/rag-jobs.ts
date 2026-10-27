import { createHash } from 'crypto';
import type { IRagSource } from '../../domain/ports';

export const RAG_JOBS_QUEUE = 'agent-rag';
/**
 * ingest / remove: one document. ingest-records: records of one table, read together. sync: every
 * table. sync-table: one table, after its fields changed. remove-table: a deleted table's documents.
 */
export type IRagJobName =
  | 'ingest'
  | 'remove'
  | 'ingest-records'
  | 'sync'
  | 'sync-table'
  | 'remove-table';

export interface IRagJobData {
  actorUserId: string;
  collectionId?: string;
  source?: IRagSource;
  /** A title given at ingest; otherwise the source's own (file name, page title, record title). */
  title?: string | null;
  /** remove: the document to delete. */
  documentId?: string;
  /** ingest-records, sync-table, remove-table. */
  baseId?: string;
  tableId?: string;
  recordIds?: string[];
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Identity of a source (design §11.3): renaming a document never changes it. */
export function sourceRefOf(source: IRagSource): string {
  switch (source.kind) {
    case 'text':
      return `text:${source.slug?.trim() || sha256(source.text).slice(0, 16)}`;
    case 'attachment':
      return `attachment:${source.token}`;
    case 'url':
      return `url:${new URL(source.url).href}`;
    case 'record':
      return `record:${source.baseId}/${source.tableId}/${source.recordId}`;
  }
}

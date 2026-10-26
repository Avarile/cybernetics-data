import { createHash } from 'crypto';
import type { IRagSource } from '../../domain/ports';

export const RAG_JOBS_QUEUE = 'agent-rag';
export type IRagJobName = 'ingest' | 'remove' | 'backfill' | 'ensure-space';

export interface IRagJobData {
  actorUserId: string;
  collectionId?: string;
  source?: IRagSource;
  /** A title given at ingest; otherwise the source's own (file name, page title, record title). */
  title?: string | null;
  /** remove: the document to delete. */
  documentId?: string;
  /** backfill: the space to fill. */
  space?: string;
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
    case 'legacy':
      return `legacy:${source.index}/${source.docName}`;
  }
}

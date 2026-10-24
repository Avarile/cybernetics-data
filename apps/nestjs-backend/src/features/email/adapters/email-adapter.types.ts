import type { IEmailFolder } from '@teable/openapi';

export interface ILoadedMessage {
  /** RFC 822 source */
  raw: Buffer;
  labels?: string[];
  isRead?: boolean;
  isStarred?: boolean;
  threadId?: string;
  /** when the provider received it; falls back to the Date header */
  receivedAt?: Date;
  /** full size in bytes, when `raw` may have been cut short */
  size?: number;
}

/** A message seen in a folder: new, or a known one whose state may have changed. */
export interface IObservedMessage {
  providerMessageId: string;
  /** the folder or label name it was seen in */
  folder: string;
  /** the full label set when the provider has one (Gmail); replaces the folders instead of adding */
  labels?: string[];
  isRead?: boolean;
  isStarred?: boolean;
  threadId?: string;
  receivedAt?: Date;
  size?: number;
  /** only called for messages that have not been imported yet */
  load(): Promise<ILoadedMessage>;
}

export interface IFolderPage {
  messages: IObservedMessage[];
  /** ids removed at the provider */
  deleted: string[];
  /**
   * Every id currently in the folder, for providers that cannot report deletions (IMAP):
   * known ids starting with `prefix` that are missing were deleted.
   */
  presence?: { prefix: string; ids: string[] };
  cursor: string;
  hasMore: boolean;
  /** messages from the first import, which counts against the source's message limit */
  isBackfill: boolean;
}

export interface IFolderSyncOptions {
  since: Date | null;
  pageSize: number;
  /** how many more messages the first import may bring in; adapters may stop early at 0 */
  backfillBudget: number;
}

export interface IEmailAdapter {
  listFolders(): Promise<IEmailFolder[]>;
  syncFolder(
    folder: IEmailFolder,
    cursor: string | null,
    options: IFolderSyncOptions
  ): Promise<IFolderPage>;
  close(): Promise<void>;
}

/** The stored cursor is from another version or provider: start the folder over. */
export const parseCursor = <T extends { v: number }>(cursor: string | null, version: number) => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as T;
    return parsed?.v === version ? parsed : null;
  } catch {
    return null;
  }
};

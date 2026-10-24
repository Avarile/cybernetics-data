/* eslint-disable @typescript-eslint/naming-convention */
import type { IEmailFolder } from '@teable/openapi';
import type { AxiosRequestConfig } from 'axios';
import axios, { isAxiosError } from 'axios';
import { HTTP_TIMEOUT_MS, MAX_RAW_MESSAGE_BYTES } from './email-adapter.constants';
import type {
  IEmailAdapter,
  IFolderPage,
  IFolderSyncOptions,
  ILoadedMessage,
  IObservedMessage,
} from './email-adapter.types';
import { parseCursor } from './email-adapter.types';

interface IGmailCursor {
  v: 1;
  /** history id to read changes from once the first import is done */
  historyId: string;
  /** first import: messages.list page token, '' before the first page; null once done */
  backfillPageToken: string | null;
  /** incremental: history.list page token within the current round */
  historyPageToken?: string;
}

interface IGmailMessageRef {
  id: string;
  threadId?: string;
  labelIds?: string[];
}

interface IGmailHistoryRecord {
  messagesAdded?: { message: IGmailMessageRef }[];
  messagesDeleted?: { message: IGmailMessageRef }[];
  labelsAdded?: { message: IGmailMessageRef }[];
  labelsRemoved?: { message: IGmailMessageRef }[];
}

const CURSOR_VERSION = 1;
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
// labels that are message state, or Gmail's own groupings, rather than folders
const HIDDEN_LABELS = new Set(['UNREAD', 'STARRED', 'CHAT', 'CATEGORY_PERSONAL']);
const SYSTEM_LABEL_NAMES: Record<string, string> = {
  INBOX: 'Inbox',
  SENT: 'Sent',
  IMPORTANT: 'Important',
  DRAFT: 'Drafts',
  SPAM: 'Spam',
  TRASH: 'Trash',
};

export class GmailEmailAdapter implements IEmailAdapter {
  private labelNames?: Map<string, string>;

  constructor(private readonly getAccessToken: () => Promise<string>) {}

  private async request<T>(path: string, config: AxiosRequestConfig = {}): Promise<T> {
    const token = await this.getAccessToken();
    const { data } = await axios.get<T>(`${API}${path}`, {
      timeout: HTTP_TIMEOUT_MS,
      ...config,
      headers: { Authorization: `Bearer ${token}`, ...config.headers },
    });
    return data;
  }

  private async getLabelNames() {
    if (!this.labelNames) {
      const { labels = [] } = await this.request<{
        labels?: { id: string; name: string; type: string }[];
      }>('/labels');
      this.labelNames = new Map(
        labels
          .filter((label) => !HIDDEN_LABELS.has(label.id) && !label.id.startsWith('CATEGORY_'))
          .map((label) => [label.id, SYSTEM_LABEL_NAMES[label.id] ?? label.name])
      );
    }
    return this.labelNames;
  }

  async listFolders(): Promise<IEmailFolder[]> {
    const names = await this.getLabelNames();
    return [...names].map(([id, name]) => ({ id, name }));
  }

  private toLabels(labelIds: string[] = [], names: Map<string, string>) {
    return labelIds.flatMap((id) => names.get(id) ?? []);
  }

  private observe(
    ref: IGmailMessageRef,
    folder: IEmailFolder,
    names: Map<string, string>
  ): IObservedMessage {
    const state = ref.labelIds
      ? {
          labels: this.toLabels(ref.labelIds, names),
          isRead: !ref.labelIds.includes('UNREAD'),
          isStarred: ref.labelIds.includes('STARRED'),
        }
      : {};
    return {
      providerMessageId: ref.id,
      folder: folder.name,
      threadId: ref.threadId,
      ...state,
      load: () => this.loadMessage(ref.id, names),
    };
  }

  private async loadMessage(id: string, names: Map<string, string>): Promise<ILoadedMessage> {
    const message = await this.request<{
      raw: string;
      threadId?: string;
      labelIds?: string[];
      internalDate?: string;
    }>(`/messages/${encodeURIComponent(id)}`, {
      params: { format: 'raw' },
      maxContentLength: Math.ceil(MAX_RAW_MESSAGE_BYTES * 1.4),
    });
    const labelIds = message.labelIds ?? [];
    return {
      raw: Buffer.from(message.raw, 'base64url'),
      threadId: message.threadId,
      ...(message.internalDate ? { receivedAt: new Date(Number(message.internalDate)) } : {}),
      labels: this.toLabels(labelIds, names),
      isRead: !labelIds.includes('UNREAD'),
      isStarred: labelIds.includes('STARRED'),
    };
  }

  async syncFolder(
    folder: IEmailFolder,
    cursorValue: string | null,
    options: IFolderSyncOptions
  ): Promise<IFolderPage> {
    const names = await this.getLabelNames();
    let cursor = parseCursor<IGmailCursor>(cursorValue, CURSOR_VERSION);
    if (!cursor) {
      const { historyId } = await this.request<{ historyId: string }>('/profile');
      cursor = { v: CURSOR_VERSION, historyId, backfillPageToken: '' };
    }
    if (cursor.backfillPageToken !== null) {
      return await this.backfillPage(folder, cursor, options, names);
    }
    try {
      return await this.historyPage(folder, cursor, options, names);
    } catch (error) {
      // history older than about a week is gone: import again since the configured date
      if (isAxiosError(error) && error.response?.status === 404) {
        return await this.syncFolder(folder, null, options);
      }
      throw error;
    }
  }

  private async backfillPage(
    folder: IEmailFolder,
    cursor: IGmailCursor,
    options: IFolderSyncOptions,
    names: Map<string, string>
  ): Promise<IFolderPage> {
    const limit = Math.min(options.pageSize, options.backfillBudget);
    if (limit <= 0) {
      return this.page([], { ...cursor, backfillPageToken: null }, true, true);
    }
    const list = await this.request<{ messages?: IGmailMessageRef[]; nextPageToken?: string }>(
      '/messages',
      {
        params: {
          labelIds: folder.id,
          maxResults: limit,
          ...(cursor.backfillPageToken ? { pageToken: cursor.backfillPageToken } : {}),
          ...(options.since ? { q: `after:${Math.floor(options.since.getTime() / 1000)}` } : {}),
        },
      }
    );
    const messages = (list.messages ?? []).map((ref) => this.observe(ref, folder, names));
    return this.page(
      messages,
      { ...cursor, backfillPageToken: list.nextPageToken ?? null },
      true,
      true
    );
  }

  private async historyPage(
    folder: IEmailFolder,
    cursor: IGmailCursor,
    options: IFolderSyncOptions,
    names: Map<string, string>
  ): Promise<IFolderPage> {
    const params = new URLSearchParams({
      startHistoryId: cursor.historyId,
      labelId: folder.id,
      maxResults: String(Math.max(options.pageSize, 100)),
    });
    for (const type of ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']) {
      params.append('historyTypes', type);
    }
    if (cursor.historyPageToken) params.set('pageToken', cursor.historyPageToken);
    const result = await this.request<{
      history?: IGmailHistoryRecord[];
      historyId: string;
      nextPageToken?: string;
    }>(`/history?${params}`);

    // the latest record per message wins; a deletion overrides earlier changes
    const changed = new Map<string, IGmailMessageRef>();
    const deleted = new Set<string>();
    for (const record of result.history ?? []) {
      for (const { message } of [
        ...(record.messagesAdded ?? []),
        ...(record.labelsAdded ?? []),
        ...(record.labelsRemoved ?? []),
      ]) {
        changed.set(message.id, message);
        deleted.delete(message.id);
      }
      for (const { message } of record.messagesDeleted ?? []) {
        changed.delete(message.id);
        deleted.add(message.id);
      }
    }
    const messages = [...changed.values()].map((ref) => this.observe(ref, folder, names));
    const next: IGmailCursor = result.nextPageToken
      ? { ...cursor, historyPageToken: result.nextPageToken }
      : { v: CURSOR_VERSION, historyId: result.historyId, backfillPageToken: null };
    return {
      ...this.page(messages, next, Boolean(result.nextPageToken), false),
      deleted: [...deleted],
    };
  }

  private page(
    messages: IObservedMessage[],
    cursor: IGmailCursor,
    hasMore: boolean,
    isBackfill: boolean
  ): IFolderPage {
    return { messages, deleted: [], cursor: JSON.stringify(cursor), hasMore, isBackfill };
  }

  async close() {
    this.labelNames = undefined;
  }
}

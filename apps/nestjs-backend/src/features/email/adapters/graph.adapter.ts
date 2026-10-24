/* eslint-disable @typescript-eslint/naming-convention, sonarjs/no-duplicate-string */
import type { IEmailFolder } from '@teable/openapi';
import axios, { isAxiosError } from 'axios';
import { HTTP_TIMEOUT_MS, MAX_RAW_MESSAGE_BYTES } from './email-adapter.constants';
import type {
  IEmailAdapter,
  IFolderPage,
  IFolderSyncOptions,
  IObservedMessage,
} from './email-adapter.types';
import { parseCursor } from './email-adapter.types';

interface IGraphCursor {
  v: 1;
  /** @odata.nextLink while a delta round is in progress, @odata.deltaLink between rounds */
  link: string;
  /** true until the first delta round has finished */
  isBackfill: boolean;
}

interface IGraphDeltaMessage {
  id: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  conversationId?: string;
  receivedDateTime?: string;
  '@removed'?: { reason: string };
}

const CURSOR_VERSION = 1;
const GRAPH = 'https://graph.microsoft.com/v1.0';

// links come back from Graph and are stored; never follow one to another host
const assertGraphLink = (link: string) => {
  const url = new URL(link);
  if (url.protocol !== 'https:' || url.host !== 'graph.microsoft.com') {
    throw new Error('Unexpected Microsoft Graph link');
  }
  return link;
};

export class GraphEmailAdapter implements IEmailAdapter {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  private async headers(pageSize?: number) {
    const prefer = ['IdType="ImmutableId"', ...(pageSize ? [`odata.maxpagesize=${pageSize}`] : [])];
    return {
      Authorization: `Bearer ${await this.getAccessToken()}`,
      // immutable ids survive moves between folders
      Prefer: prefer.join(', '),
    };
  }

  async listFolders(): Promise<IEmailFolder[]> {
    const folders: IEmailFolder[] = [];
    let link: string | undefined = `${GRAPH}/me/mailFolders?$top=100&$select=id,displayName`;
    while (link) {
      const response: {
        data: { value: { id: string; displayName: string }[]; '@odata.nextLink'?: string };
      } = await axios.get(assertGraphLink(link), {
        headers: await this.headers(),
        timeout: HTTP_TIMEOUT_MS,
      });
      folders.push(
        ...response.data.value.map((folder) => ({ id: folder.id, name: folder.displayName }))
      );
      link = response.data['@odata.nextLink'];
    }
    return folders;
  }

  private initialLink(folder: IEmailFolder, since: Date | null) {
    // OData wants %20 for spaces; URLSearchParams would write `+`
    const params = [
      ['$select', 'id,isRead,flag,conversationId,receivedDateTime'],
      ...(since ? [['$filter', `receivedDateTime ge ${since.toISOString()}`]] : []),
    ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
    return `${GRAPH}/me/mailFolders/${encodeURIComponent(folder.id)}/messages/delta?${params.join('&')}`;
  }

  async syncFolder(
    folder: IEmailFolder,
    cursorValue: string | null,
    options: IFolderSyncOptions
  ): Promise<IFolderPage> {
    const cursor = parseCursor<IGraphCursor>(cursorValue, CURSOR_VERSION) ?? {
      v: CURSOR_VERSION,
      link: this.initialLink(folder, options.since),
      isBackfill: true,
    };
    let data: {
      value: IGraphDeltaMessage[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };
    try {
      ({ data } = await axios.get(assertGraphLink(cursor.link), {
        headers: await this.headers(options.pageSize),
        timeout: HTTP_TIMEOUT_MS,
      }));
    } catch (error) {
      // the delta token expired: start the folder over (imported mail is matched, not duplicated)
      if (isAxiosError(error) && error.response?.status === 410) {
        return await this.syncFolder(folder, null, options);
      }
      throw error;
    }

    const deleted = data.value.filter((item) => item['@removed']).map((item) => item.id);
    const messages: IObservedMessage[] = data.value
      .filter((item) => !item['@removed'])
      .map((item) => ({
        providerMessageId: item.id,
        folder: folder.name,
        threadId: item.conversationId,
        ...(item.receivedDateTime ? { receivedAt: new Date(item.receivedDateTime) } : {}),
        ...(item.isRead === undefined ? {} : { isRead: item.isRead }),
        ...(item.flag ? { isStarred: item.flag.flagStatus === 'flagged' } : {}),
        load: async () => {
          const { data: raw } = await axios.get<ArrayBuffer>(
            `${GRAPH}/me/messages/${encodeURIComponent(item.id)}/$value`,
            {
              headers: await this.headers(),
              responseType: 'arraybuffer',
              timeout: HTTP_TIMEOUT_MS,
              maxContentLength: MAX_RAW_MESSAGE_BYTES,
            }
          );
          return { raw: Buffer.from(raw) };
        },
      }));

    const nextLink = data['@odata.nextLink'];
    const next: IGraphCursor = nextLink
      ? { ...cursor, link: nextLink }
      : { v: CURSOR_VERSION, link: data['@odata.deltaLink'] ?? cursor.link, isBackfill: false };
    return {
      messages,
      deleted,
      cursor: JSON.stringify(next),
      hasMore: Boolean(nextLink),
      isBackfill: cursor.isBackfill,
    };
  }

  async close() {
    // stateless
  }
}

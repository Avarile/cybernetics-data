/* eslint-disable @typescript-eslint/naming-convention */
import { Logger } from '@nestjs/common';
import type { IEmailFolder } from '@teable/openapi';
import type { ImapFlow } from 'imapflow';
import type { IMailServerCredentials } from '../../user-integration/mail-server.tester';
import { createImapClient } from '../../user-integration/mail-server.tester';
import { MAX_RAW_MESSAGE_BYTES } from './email-adapter.constants';
import type {
  IEmailAdapter,
  IFolderPage,
  IFolderSyncOptions,
  IObservedMessage,
} from './email-adapter.types';
import { parseCursor } from './email-adapter.types';

interface IImapCursor {
  v: 1;
  uidValidity: string;
  /** highest UID handled by incremental sync (or present when the first import started) */
  lastUid: number;
  modseq?: string;
  /**
   * Without CONDSTORE: read/starred bits (1 = read, 2 = starred) of the newest messages, to
   * report only the ones that changed
   */
  flags?: Record<string, number>;
  /** the first import continues below this UID; null once it is done */
  backfillBefore: number | null;
}

const CURSOR_VERSION = 1;
// how many of the newest messages are checked for read/starred changes without CONDSTORE
const FLAG_WINDOW = 200;
// folders that are never useful to import
const SKIPPED_SPECIAL_USE = new Set(['\\All', '\\Junk', '\\Trash', '\\Drafts']);

/** `<folder>|<uidValidity>|<uid>`: UIDs are only unique within one folder and UIDVALIDITY. */
export const imapMessageId = (folder: string, uidValidity: string, uid: number) =>
  `${folder}|${uidValidity}|${uid}`;

const flagsOf = (flags?: Set<string>) =>
  flags ? { isRead: flags.has('\\Seen'), isStarred: flags.has('\\Flagged') } : {};

const flagBits = (flags?: Set<string>) =>
  (flags?.has('\\Seen') ? 1 : 0) | (flags?.has('\\Flagged') ? 2 : 0);

export class ImapEmailAdapter implements IEmailAdapter {
  private readonly logger = new Logger(ImapEmailAdapter.name);
  private client?: ImapFlow;

  constructor(
    private readonly server: IMailServerCredentials,
    private readonly allowPrivateHosts: boolean
  ) {}

  private async connect() {
    if (!this.client?.usable) {
      this.client = await createImapClient(this.server, {
        allowPrivateHosts: this.allowPrivateHosts,
        logger: this.logger,
      });
      await this.client.connect();
    }
    return this.client;
  }

  async listFolders(): Promise<IEmailFolder[]> {
    const client = await this.connect();
    const mailboxes = await client.list();
    return mailboxes
      .filter(
        (box) => !box.flags.has('\\Noselect') && !SKIPPED_SPECIAL_USE.has(box.specialUse ?? '')
      )
      .map((box) => ({ id: box.path, name: box.path === 'INBOX' ? 'Inbox' : box.path }));
  }

  async syncFolder(
    folder: IEmailFolder,
    cursorValue: string | null,
    options: IFolderSyncOptions
  ): Promise<IFolderPage> {
    const client = await this.connect();
    const mailbox = await client.mailboxOpen(folder.id, { readOnly: true });
    const uidValidity = mailbox.uidValidity.toString();
    let cursor = parseCursor<IImapCursor>(cursorValue, CURSOR_VERSION);
    if (!cursor || cursor.uidValidity !== uidValidity) {
      // first sync, or the server renumbered the folder: import again from the newest message;
      // Message-ID matching keeps already imported mail from being duplicated
      cursor = {
        v: CURSOR_VERSION,
        uidValidity,
        lastUid: mailbox.uidNext - 1,
        modseq: mailbox.highestModseq?.toString(),
        backfillBefore: mailbox.uidNext,
      };
    }

    const observe = (uid: number, extra: Partial<IObservedMessage> = {}): IObservedMessage => ({
      providerMessageId: imapMessageId(folder.id, uidValidity, uid),
      folder: folder.name,
      ...extra,
      load: async () => {
        const message = await client.fetchOne(
          String(uid),
          {
            uid: true,
            flags: true,
            internalDate: true,
            size: true,
            source: { maxLength: MAX_RAW_MESSAGE_BYTES },
          },
          { uid: true }
        );
        if (!message || !message.source) {
          throw new Error(`Message ${uid} is no longer in ${folder.id}`);
        }
        return {
          raw: message.source,
          ...flagsOf(message.flags),
          ...(message.internalDate ? { receivedAt: new Date(message.internalDate) } : {}),
          ...(message.size ? { size: message.size } : {}),
        };
      },
    });

    if (cursor.backfillBefore !== null) {
      return await this.backfillPage(client, cursor, options, observe);
    }
    return await this.incrementalPage(
      client,
      folder,
      cursor,
      mailbox.highestModseq,
      options,
      observe
    );
  }

  private async backfillPage(
    client: ImapFlow,
    cursor: IImapCursor,
    options: IFolderSyncOptions,
    observe: (uid: number, extra?: Partial<IObservedMessage>) => IObservedMessage
  ): Promise<IFolderPage> {
    const before = cursor.backfillBefore!;
    const limit = Math.min(options.pageSize, options.backfillBudget);
    const uids =
      limit > 0 && before > 1
        ? (await client.search(
            { uid: `1:${before - 1}`, ...(options.since ? { since: options.since } : {}) },
            { uid: true }
          )) || []
        : [];
    const batch = uids
      .filter((uid) => uid < before)
      .sort((a, b) => a - b)
      .slice(-limit);
    const done = batch.length === 0;
    const next: IImapCursor = { ...cursor, backfillBefore: done ? null : batch[0] };
    // newest first, so a partial import holds the most recent mail
    const messages = batch.reverse().map((uid) => observe(uid));
    return { messages, deleted: [], cursor: JSON.stringify(next), hasMore: true, isBackfill: true };
  }

  private async incrementalPage(
    client: ImapFlow,
    folder: IEmailFolder,
    cursor: IImapCursor,
    highestModseq: bigint | undefined,
    options: IFolderSyncOptions,
    observe: (uid: number, extra?: Partial<IObservedMessage>) => IObservedMessage
  ): Promise<IFolderPage> {
    // `n:*` always matches the last message, even when its UID is below n
    const newUids = ((await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true })) || [])
      .filter((uid) => uid > cursor.lastUid)
      .sort((a, b) => a - b);
    const batch = newUids.slice(0, options.pageSize);
    const hasMore = newUids.length > batch.length;
    const next: IImapCursor = {
      ...cursor,
      lastUid: batch.length ? batch[batch.length - 1] : cursor.lastUid,
    };
    const messages = batch.map((uid) => observe(uid));
    if (hasMore) {
      return { messages, deleted: [], cursor: JSON.stringify(next), hasMore, isBackfill: false };
    }

    // caught up: report read/starred changes and what is still in the folder
    if (highestModseq && cursor.modseq) {
      if (highestModseq > BigInt(cursor.modseq)) {
        const changed = await client.fetchAll(
          `1:${cursor.lastUid}`,
          { uid: true, flags: true },
          { uid: true, changedSince: BigInt(cursor.modseq) }
        );
        messages.push(...changed.map((message) => observe(message.uid, flagsOf(message.flags))));
      }
      next.modseq = highestModseq.toString();
    } else if (next.lastUid > 0) {
      const recent = await client.fetchAll(
        `${Math.max(1, next.lastUid - FLAG_WINDOW + 1)}:${next.lastUid}`,
        { uid: true, flags: true },
        { uid: true }
      );
      const previous = cursor.flags;
      next.flags = Object.fromEntries(recent.map((m) => [String(m.uid), flagBits(m.flags)]));
      // the first snapshot only records; new messages carry their flags when imported
      if (previous) {
        const isNew = new Set(batch);
        messages.push(
          ...recent
            .filter((m) => !isNew.has(m.uid) && previous[String(m.uid)] !== undefined)
            .filter((m) => previous[String(m.uid)] !== flagBits(m.flags))
            .map((m) => observe(m.uid, flagsOf(m.flags)))
        );
      }
    }
    const present = (await client.search({ all: true }, { uid: true })) || [];
    const prefix = imapMessageId(folder.id, cursor.uidValidity, 0).slice(0, -1);
    return {
      messages,
      deleted: [],
      presence: { prefix, ids: present.map((uid) => `${prefix}${uid}`) },
      cursor: JSON.stringify(next),
      hasMore: false,
      isBackfill: false,
    };
  }

  async close() {
    if (this.client?.usable) {
      await this.client.logout().catch(() => this.client?.close());
    }
    this.client = undefined;
  }
}

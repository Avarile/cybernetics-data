/* eslint-disable @typescript-eslint/naming-convention */
import { createImapClient } from '../../user-integration/mail-server.tester';
import { ImapEmailAdapter, imapMessageId } from './imap.adapter';

vi.mock('../../user-integration/mail-server.tester', () => ({ createImapClient: vi.fn() }));

/** An IMAP folder whose UIDs and flags the test controls. */
const fakeServer = (state: {
  uidValidity: bigint;
  uids: number[];
  modseq?: bigint;
  changed?: { uid: number; flags: Set<string> }[];
}) => {
  const inRange = (range: string, uid: number) => {
    const [from, to] = range.split(':');
    return uid >= Number(from) && (to === '*' || uid <= Number(to));
  };
  return {
    usable: true,
    connect: vi.fn(),
    logout: vi.fn(),
    close: vi.fn(),
    list: vi.fn(async () => [
      { path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' },
      { path: '[Gmail]/All Mail', flags: new Set(), specialUse: '\\All' },
      { path: '[Gmail]', flags: new Set(['\\Noselect']) },
      { path: 'Work', flags: new Set() },
    ]),
    mailboxOpen: vi.fn(async () => ({
      uidValidity: state.uidValidity,
      uidNext: Math.max(0, ...state.uids) + 1,
      highestModseq: state.modseq,
    })),
    search: vi.fn(async (query: { uid?: string; all?: boolean }) => {
      if (query.all) return state.uids;
      const matches = state.uids.filter((uid) => inRange(query.uid!, uid));
      // like real servers, `n:*` also matches the last message
      if (query.uid!.endsWith(':*') && !matches.length && state.uids.length) {
        return [Math.max(...state.uids)];
      }
      return matches;
    }),
    fetchOne: vi.fn(async (uid: string) => ({
      uid: Number(uid),
      flags: new Set(['\\Seen']),
      source: Buffer.from(`Subject: ${uid}\r\n\r\nbody`),
      size: 123,
    })),
    fetchAll: vi.fn(async () => state.changed ?? []),
  };
};

describe('ImapEmailAdapter', () => {
  const inbox = { id: 'INBOX', name: 'Inbox' };
  const server = {
    host: 'imap.example.com',
    port: 993,
    secure: true,
    username: 'u',
    password: 'p',
  };
  const options = { since: null, pageSize: 2, backfillBudget: 100 };

  it('lists selectable folders except All Mail', async () => {
    vi.mocked(createImapClient).mockResolvedValue(
      fakeServer({ uidValidity: 1n, uids: [] }) as never
    );
    const adapter = new ImapEmailAdapter(server, false);
    expect(await adapter.listFolders()).toEqual([
      { id: 'INBOX', name: 'Inbox' },
      { id: 'Work', name: 'Work' },
    ]);
  });

  it('imports newest first in pages, then follows new mail, flags and deletions', async () => {
    const state = { uidValidity: 7n, uids: [1, 2, 3], modseq: 10n } as Parameters<
      typeof fakeServer
    >[0];
    const client = fakeServer(state);
    vi.mocked(createImapClient).mockResolvedValue(client as never);
    const adapter = new ImapEmailAdapter(server, false);

    const page1 = await adapter.syncFolder(inbox, null, options);
    expect(page1.messages.map((m) => m.providerMessageId)).toEqual([
      imapMessageId('INBOX', '7', 3),
      imapMessageId('INBOX', '7', 2),
    ]);
    expect(page1.isBackfill).toBe(true);
    const loaded = await page1.messages[0].load();
    expect(loaded).toMatchObject({ isRead: true, isStarred: false, size: 123 });

    const page2 = await adapter.syncFolder(inbox, page1.cursor, options);
    expect(page2.messages.map((m) => m.providerMessageId)).toEqual([
      imapMessageId('INBOX', '7', 1),
    ]);
    const page3 = await adapter.syncFolder(inbox, page2.cursor, options);
    expect(page3).toMatchObject({ messages: [], isBackfill: true });

    // new mail, a flag change and a deletion
    state.uids = [2, 3, 4];
    state.modseq = 12n;
    state.changed = [{ uid: 2, flags: new Set(['\\Flagged']) }];
    const page4 = await adapter.syncFolder(inbox, page3.cursor, options);
    expect(page4.isBackfill).toBe(false);
    expect(page4.messages.map((m) => [m.providerMessageId, m.isStarred])).toEqual([
      [imapMessageId('INBOX', '7', 4), undefined],
      [imapMessageId('INBOX', '7', 2), true],
    ]);
    expect(client.fetchAll).toHaveBeenCalledWith(
      '1:3',
      expect.anything(),
      expect.objectContaining({ changedSince: 10n })
    );
    expect(page4.presence).toEqual({
      prefix: 'INBOX|7|',
      ids: ['INBOX|7|2', 'INBOX|7|3', 'INBOX|7|4'],
    });
    expect(JSON.parse(page4.cursor)).toMatchObject({
      lastUid: 4,
      modseq: '12',
      backfillBefore: null,
    });

    // nothing new: `5:*` matching the last message must not import it again
    const page5 = await adapter.syncFolder(inbox, page4.cursor, options);
    expect(page5.messages).toEqual([]);
  });

  it('reports only changed flags on servers without CONDSTORE', async () => {
    const state = { uidValidity: 3n, uids: [1, 2], changed: [] } as Parameters<
      typeof fakeServer
    >[0];
    const client = fakeServer(state);
    vi.mocked(createImapClient).mockResolvedValue(client as never);
    const adapter = new ImapEmailAdapter(server, false);
    const caughtUp = JSON.stringify({ v: 1, uidValidity: '3', lastUid: 2, backfillBefore: null });

    client.fetchAll.mockResolvedValueOnce([
      { uid: 1, flags: new Set(['\\Seen']) },
      { uid: 2, flags: new Set() },
    ] as never);
    const first = await adapter.syncFolder(inbox, caughtUp, options);
    expect(first.messages).toEqual([]);
    expect(JSON.parse(first.cursor).flags).toEqual({ 1: 1, 2: 0 });

    client.fetchAll.mockResolvedValueOnce([
      { uid: 1, flags: new Set(['\\Seen']) },
      { uid: 2, flags: new Set(['\\Seen', '\\Flagged']) },
    ] as never);
    const second = await adapter.syncFolder(inbox, first.cursor, options);
    expect(second.messages.map((m) => [m.providerMessageId, m.isRead, m.isStarred])).toEqual([
      ['INBOX|3|2', true, true],
    ]);
    expect(client.fetchAll).toHaveBeenLastCalledWith('1:2', expect.anything(), { uid: true });
  });

  it('starts the folder over when UIDVALIDITY changes', async () => {
    const state = { uidValidity: 7n, uids: [5] };
    vi.mocked(createImapClient).mockResolvedValue(fakeServer(state) as never);
    const adapter = new ImapEmailAdapter(server, false);
    const cursor = JSON.stringify({ v: 1, uidValidity: '6', lastUid: 99, backfillBefore: null });
    const page = await adapter.syncFolder(inbox, cursor, options);
    expect(page.isBackfill).toBe(true);
    expect(page.messages.map((m) => m.providerMessageId)).toEqual(['INBOX|7|5']);
  });

  it('stops the first import at the message limit', async () => {
    vi.mocked(createImapClient).mockResolvedValue(
      fakeServer({ uidValidity: 1n, uids: [1, 2] }) as never
    );
    const adapter = new ImapEmailAdapter(server, false);
    const page = await adapter.syncFolder(inbox, null, { ...options, backfillBudget: 0 });
    expect(page.messages).toEqual([]);
    expect(JSON.parse(page.cursor).backfillBefore).toBeNull();
  });
});

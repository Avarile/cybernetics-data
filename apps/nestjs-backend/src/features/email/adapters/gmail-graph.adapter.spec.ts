/* eslint-disable @typescript-eslint/naming-convention, sonarjs/no-duplicate-string */
import axios from 'axios';
import { GmailEmailAdapter } from './gmail.adapter';
import { GraphEmailAdapter } from './graph.adapter';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<{ default: object }>();
  return { ...actual, default: { ...actual.default, get: vi.fn() } };
});

const axiosError = (status: number) =>
  Object.assign(new Error(String(status)), { isAxiosError: true, response: { status } });

const options = { since: null, pageSize: 25, backfillBudget: 100 };

describe('GmailEmailAdapter', () => {
  const inbox = { id: 'INBOX', name: 'Inbox' };
  let routes: Record<string, unknown>;

  beforeEach(() => {
    vi.resetAllMocks();
    routes = {
      '/profile': { historyId: '100' },
      '/labels': {
        labels: [
          { id: 'INBOX', name: 'INBOX', type: 'system' },
          { id: 'UNREAD', name: 'UNREAD', type: 'system' },
          { id: 'CATEGORY_UPDATES', name: 'CATEGORY_UPDATES', type: 'system' },
          { id: 'Label_1', name: 'Work', type: 'user' },
        ],
      },
    };
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      const path = url.replace('https://gmail.googleapis.com/gmail/v1/users/me', '').split('?')[0];
      const data = routes[path];
      if (data instanceof Error) throw data;
      if (data === undefined) throw axiosError(404);
      return { data };
    });
  });

  it('lists labels as folders, without state labels and categories', async () => {
    const adapter = new GmailEmailAdapter(async () => 'token');
    expect(await adapter.listFolders()).toEqual([
      { id: 'INBOX', name: 'Inbox' },
      { id: 'Label_1', name: 'Work' },
    ]);
  });

  it('imports the label, then follows history', async () => {
    const adapter = new GmailEmailAdapter(async () => 'token');
    routes['/messages'] = { messages: [{ id: 'm1', threadId: 't1' }] };
    routes['/messages/m1'] = {
      raw: Buffer.from('Subject: hi\r\n\r\nx').toString('base64url'),
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD', 'Label_1'],
      internalDate: '1792000000000',
    };

    const first = await adapter.syncFolder(inbox, null, options);
    expect(first).toMatchObject({ isBackfill: true, hasMore: true });
    expect(JSON.parse(first.cursor)).toMatchObject({ historyId: '100', backfillPageToken: null });
    const loaded = await first.messages[0].load();
    expect(loaded).toMatchObject({ labels: ['Inbox', 'Work'], isRead: false, isStarred: false });
    expect(loaded.raw.toString()).toContain('Subject: hi');
    expect(loaded.receivedAt?.getTime()).toBe(1792000000000);

    routes['/history'] = {
      historyId: '120',
      history: [
        { messagesAdded: [{ message: { id: 'm2', labelIds: ['INBOX'] } }] },
        { labelsRemoved: [{ message: { id: 'm1', labelIds: ['Label_1'] } }] },
        { messagesAdded: [{ message: { id: 'm3', labelIds: ['INBOX'] } }] },
        { messagesDeleted: [{ message: { id: 'm3' } }] },
      ],
    };
    const second = await adapter.syncFolder(inbox, first.cursor, options);
    expect(second).toMatchObject({ isBackfill: false, hasMore: false, deleted: ['m3'] });
    expect(second.messages.map((m) => [m.providerMessageId, m.labels, m.isRead])).toEqual([
      ['m2', ['Inbox'], true],
      ['m1', ['Work'], true],
    ]);
    expect(JSON.parse(second.cursor)).toMatchObject({ historyId: '120' });
  });

  it('starts over when the history is too old', async () => {
    const adapter = new GmailEmailAdapter(async () => 'token');
    const cursor = JSON.stringify({ v: 1, historyId: '1', backfillPageToken: null });
    routes['/messages'] = { messages: [] };
    const page = await adapter.syncFolder(inbox, cursor, options);
    expect(page.isBackfill).toBe(true);
    expect(JSON.parse(page.cursor).historyId).toBe('100');
  });

  it('stops the first import when the message limit is reached', async () => {
    const adapter = new GmailEmailAdapter(async () => 'token');
    const page = await adapter.syncFolder(inbox, null, { ...options, backfillBudget: 0 });
    expect(page.messages).toEqual([]);
    expect(JSON.parse(page.cursor).backfillPageToken).toBeNull();
    expect(vi.mocked(axios.get).mock.calls.some(([url]) => String(url).includes('/messages'))).toBe(
      false
    );
  });
});

describe('GraphEmailAdapter', () => {
  const inbox = { id: 'AAMk=', name: 'Inbox' };
  const adapter = new GraphEmailAdapter(async () => 'token');

  beforeEach(() => vi.resetAllMocks());

  it('pages through the first delta round, then keeps the delta link', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: {
          value: [
            { id: 'a', isRead: false, flag: { flagStatus: 'flagged' }, conversationId: 'c1' },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next?token=1',
        },
      })
      .mockResolvedValueOnce({
        data: {
          value: [{ id: 'b', '@removed': { reason: 'deleted' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=2',
        },
      });

    const since = new Date('2026-10-01T00:00:00Z');
    const first = await adapter.syncFolder(inbox, null, { ...options, since });
    const [url, config] = vi.mocked(axios.get).mock.calls[0];
    expect(String(url)).toContain('/me/mailFolders/AAMk%3D/messages/delta');
    expect(decodeURIComponent(String(url))).toContain(
      'receivedDateTime ge 2026-10-01T00:00:00.000Z'
    );
    expect((config?.headers as Record<string, string>).Prefer).toContain('IdType="ImmutableId"');
    expect(first).toMatchObject({ isBackfill: true, hasMore: true, deleted: [] });
    expect(first.messages[0]).toMatchObject({
      providerMessageId: 'a',
      isRead: false,
      isStarred: true,
      threadId: 'c1',
    });

    const second = await adapter.syncFolder(inbox, first.cursor, options);
    expect(second).toMatchObject({ isBackfill: true, hasMore: false, deleted: ['b'] });
    expect(JSON.parse(second.cursor)).toEqual({
      v: 1,
      link: 'https://graph.microsoft.com/v1.0/delta?token=2',
      isBackfill: false,
    });
  });

  it('refuses a stored link to another host', async () => {
    const cursor = JSON.stringify({ v: 1, link: 'https://evil.example.com/x', isBackfill: false });
    await expect(adapter.syncFolder(inbox, cursor, options)).rejects.toThrow('Unexpected');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('starts over when the delta token expired', async () => {
    vi.mocked(axios.get)
      .mockRejectedValueOnce(axiosError(410))
      .mockResolvedValueOnce({
        data: { value: [], '@odata.deltaLink': 'https://graph.microsoft.com/d' },
      });
    const cursor = JSON.stringify({
      v: 1,
      link: 'https://graph.microsoft.com/old',
      isBackfill: false,
    });
    const page = await adapter.syncFolder(inbox, cursor, options);
    expect(page.isBackfill).toBe(true);
    expect(String(vi.mocked(axios.get).mock.calls[1][0])).toContain('/messages/delta');
  });
});

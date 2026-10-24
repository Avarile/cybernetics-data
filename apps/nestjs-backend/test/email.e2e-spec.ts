/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Email tables end to end: connect a mailbox, create the table, sync, follow changes.
 *
 * By default the mailbox is a scripted fake, so this runs anywhere. To run it against a real IMAP
 * server instead, start GreenMail and set EMAIL_E2E_IMAP_PORT:
 *   docker run --rm -p 3025:3025 -p 3993:3993 -e GREENMAIL_OPTS='-Dgreenmail.setup.test.smtp
 *     -Dgreenmail.setup.test.imaps -Dgreenmail.hostname=0.0.0.0
 *     -Dgreenmail.users=test:secret@example.com' greenmail/standalone:2.1.2
 *   EMAIL_E2E_IMAP_PORT=3993 NODE_TLS_REJECT_UNAUTHORIZED=0 pnpm vitest run --config
 *     ./vitest-e2e.config.ts test/email.e2e-spec.ts
 */
import type { INestApplication } from '@nestjs/common';
import type { IEmailSourceVo } from '@teable/openapi';
import {
  createEmailTable,
  createImapIntegration,
  deleteUserIntegration,
  EmailSourceStatus,
  getEmailSourceList,
  getUserIntegrationFolders,
  getUserIntegrationList,
  syncEmailSource,
  updateEmailSource,
} from '@teable/openapi';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import type { Options as MailOptions } from 'nodemailer/lib/mailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { MailServerTester } from '../src/features/user-integration/mail-server.tester';
import { getError } from './utils/get-error';
import {
  deleteRecord,
  getFields,
  getRecords,
  getViews,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

const imapPort = process.env.EMAIL_E2E_IMAP_PORT;
const realServer = Boolean(imapPort);

/** The scripted mailbox: every sync reports all messages, plus deletions since the last one. */
const fakeMailbox = vi.hoisted(() => ({
  messages: new Map<
    string,
    { raw: Buffer; isRead: boolean; isStarred: boolean; subject: string }
  >(),
  deleted: [] as string[],
  nextId: 1,
}));

vi.mock('../src/features/email/adapters/create-email-adapter', async (importOriginal) => {
  const actual = await importOriginal<object>();
  if (process.env.EMAIL_E2E_IMAP_PORT) return actual;
  return {
    createEmailAdapter: () => ({
      listFolders: async () => [
        { id: 'INBOX', name: 'Inbox' },
        { id: 'Archive', name: 'Archive' },
      ],
      syncFolder: async (folder: { id: string; name: string }, cursor: string | null) => {
        if (folder.id !== 'INBOX') {
          return { messages: [], deleted: [], cursor: 'c', hasMore: false, isBackfill: false };
        }
        return {
          messages: [...fakeMailbox.messages].map(([id, m]) => ({
            providerMessageId: id,
            folder: folder.name,
            isRead: m.isRead,
            isStarred: m.isStarred,
            load: async () => ({ raw: m.raw }),
          })),
          deleted: fakeMailbox.deleted.splice(0),
          cursor: 'c',
          hasMore: false,
          isBackfill: cursor === null,
        };
      },
      close: async () => undefined,
    }),
  };
});

const compose = (options: MailOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    new MailComposer(options)
      .compile()
      .build((error, message) => (error ? reject(error) : resolve(message)))
  );

/** Delivers mail and changes it at the "provider", fake or real. */
const mailbox = {
  async deliver(options: MailOptions) {
    const mail = { from: '"Alice" <alice@example.com>', to: 'test@example.com', ...options };
    if (realServer) {
      const smtp = createTransport({
        host: '127.0.0.1',
        port: 3025,
        secure: false,
        ignoreTLS: true,
      });
      await smtp.sendMail(mail);
      smtp.close();
      return;
    }
    fakeMailbox.messages.set(`m${fakeMailbox.nextId++}`, {
      raw: await compose(mail),
      isRead: false,
      isStarred: false,
      subject: String(mail.subject),
    });
  },
  async withImap(run: (client: ImapFlow) => Promise<void>) {
    const client = new ImapFlow({
      host: '127.0.0.1',
      port: Number(imapPort),
      secure: true,
      auth: { user: 'test', pass: 'secret' },
      logger: false,
    });
    await client.connect();
    await client.mailboxOpen('INBOX');
    try {
      await run(client);
    } finally {
      await client.logout();
    }
  },
  async star(subject: string) {
    if (realServer) {
      await this.withImap((client) =>
        client.messageFlagsAdd({ subject }, ['\\Flagged']).then(() => undefined)
      );
      return;
    }
    [...fakeMailbox.messages.values()].find((m) => m.subject === subject)!.isStarred = true;
  },
  async remove(subject: string) {
    if (realServer) {
      await this.withImap((client) => client.messageDelete({ subject }).then(() => undefined));
      return;
    }
    const [id] = [...fakeMailbox.messages].find(([, m]) => m.subject === subject)!;
    fakeMailbox.messages.delete(id);
    fakeMailbox.deleted.push(id);
  },
};

describe('Email tables (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let integrationId: string;
  let source: IEmailSourceVo;
  let tableId: string;

  const getSource = async () =>
    (await getEmailSourceList(baseId)).data.find((item) => item.id === source.id)!;

  /** Starts a sync (or waits for the one already queued) and waits until it has finished. */
  const sync = async (trigger = true) => {
    const before = (await getSource()).lastSyncedTime;
    if (trigger) await syncEmailSource(baseId, source.id);
    for (let i = 0; i < 100; i++) {
      const current = await getSource();
      if (current.status === EmailSourceStatus.Error) {
        throw new Error(`sync failed: ${current.lastError}`);
      }
      if (current.status === EmailSourceStatus.Idle && current.lastSyncedTime !== before) {
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('sync did not finish');
  };

  const recordsBySubject = async () => {
    const { records } = await getRecords(tableId);
    return new Map(records.map((record) => [record.fields.subject as string, record]));
  };

  beforeAll(async () => {
    process.env.EMAIL_ALLOW_PRIVATE_HOSTS = 'true';
    app = (await initApp()).app;
    if (!realServer) {
      vi.spyOn(MailServerTester.prototype, 'testImap').mockResolvedValue();
    }
  });

  afterAll(async () => {
    if (tableId) await permanentDeleteTable(baseId, tableId);
    if (integrationId) await deleteUserIntegration(integrationId);
    await app.close();
  });

  it('connects an IMAP mailbox and lists its folders', async () => {
    integrationId = (
      await createImapIntegration({
        email: 'test@example.com',
        imap: {
          host: '127.0.0.1',
          port: Number(imapPort ?? 993),
          secure: true,
          username: 'test',
          password: 'secret',
        },
      })
    ).data.id;
    const { integrations } = (await getUserIntegrationList()).data;
    const integration = integrations.find((item) => item.id === integrationId)!;
    expect(integration).toMatchObject({ provider: 'imap', hasSecret: true, status: 'active' });
    expect(JSON.stringify(integration)).not.toContain('secret"');

    const folders = (await getUserIntegrationFolders(integrationId)).data;
    expect(folders).toContainEqual({ id: 'INBOX', name: 'Inbox' });
  });

  it('creates the email table and imports existing mail', async () => {
    await mailbox.deliver({
      subject: 'Quarterly report',
      html: '<h1>Report</h1><p>See attached. <img src="https://tracker.example.com/p.gif"></p>',
      attachments: [{ filename: 'report.txt', content: 'numbers' }],
      headers: { Importance: 'high' },
      messageId: '<report@example.com>',
    });
    await mailbox.deliver({ subject: 'Lunch?', text: 'Noon at the usual place.' });

    const created = (
      await createEmailTable(baseId, {
        integrationId,
        folders: [{ id: 'INBOX', name: 'Inbox' }],
        since: null,
        maxMessages: 100,
        includeAttachments: true,
        maxAttachmentMb: 5,
        intervalMin: 60,
        timeZone: 'UTC',
      })
    ).data;
    tableId = created.tableId;
    source = (await getEmailSourceList(baseId)).data.find((item) => item.tableId === tableId)!;
    expect(source).toMatchObject({ integrationId, address: 'test@example.com', provider: 'imap' });

    const fields = await getFields(tableId);
    expect(fields.find((field) => field.isPrimary)?.name).toBe('subject');
    expect(fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'from',
        'received_at',
        'body',
        'attachments',
        'folders',
        'deleted_at_source',
      ])
    );
    const views = await getViews(tableId);
    expect(views.map((view) => view.name)).toEqual(['All mail', 'Unread', 'With attachments']);
    const bodyField = fields.find((field) => field.name === 'body')!;
    expect(views[0].columnMeta[bodyField.id]).toMatchObject({ hidden: true });

    // creating the table queued the first import
    const synced = await sync(false);
    expect(synced.messageCount).toBe(2);
    const records = await recordsBySubject();
    const report = records.get('Quarterly report')!;
    expect(report.fields).toMatchObject({
      from: 'alice@example.com',
      from_name: 'Alice',
      importance: 'high',
      has_attachments: true,
      folders: ['Inbox'],
      message_id: '<report@example.com>',
      mailbox: 'test@example.com',
    });
    expect(report.fields.body).toContain('# Report');
    expect(report.fields.body).not.toContain('tracker');
    expect(report.fields.attachments).toEqual([
      expect.objectContaining({ name: 'report.txt', size: 7 }),
    ]);
    expect(records.get('Lunch?')?.fields.is_read).toBeUndefined();
  });

  it('follows new mail, flag changes and deletions without duplicating', async () => {
    await mailbox.deliver({ subject: 'New invoice', text: 'Due Friday.' });
    await mailbox.star('Lunch?');
    await mailbox.remove('Quarterly report');
    if (realServer) {
      // without CONDSTORE the first caught-up sync only records the flags it sees
      await sync();
      await mailbox.star('New invoice');
    }

    const synced = await sync();
    const records = await recordsBySubject();
    expect([...records.keys()].sort()).toEqual(['Lunch?', 'New invoice', 'Quarterly report']);
    expect(synced.messageCount).toBe(3);
    expect(records.get('Quarterly report')?.fields.deleted_at_source).toBe(true);
    expect(records.get('Lunch?')?.fields.is_starred).toBe(true);
  });

  it('never brings back a record a user deleted', async () => {
    const records = await recordsBySubject();
    await deleteRecord(tableId, records.get('Lunch?')!.id);
    await mailbox.star('New invoice');
    await sync();
    expect((await recordsBySubject()).has('Lunch?')).toBe(false);
  });

  it('pauses and resumes', async () => {
    const paused = (await updateEmailSource(baseId, source.id, { paused: true })).data;
    expect(paused.status).toBe(EmailSourceStatus.Paused);
    const error = await getError(() => syncEmailSource(baseId, source.id));
    expect(error?.status).toBe(400);

    const resumed = (await updateEmailSource(baseId, source.id, { paused: false })).data;
    expect(resumed.status).not.toBe(EmailSourceStatus.Paused);
    await sync(false);
  });

  it('changes settings and validates input', async () => {
    const updated = (
      await updateEmailSource(baseId, source.id, { includeAttachments: false, intervalMin: 15 })
    ).data;
    expect(updated.config).toMatchObject({ includeAttachments: false, intervalMin: 15 });

    const invalid = await getError(() => updateEmailSource(baseId, source.id, { intervalMin: 1 }));
    expect(invalid?.status).toBe(400);
    const notMine = await getError(() =>
      createEmailTable(baseId, {
        integrationId: 'uinSomeoneElse000',
        folders: [{ id: 'INBOX', name: 'Inbox' }],
        since: null,
        maxMessages: 10,
        includeAttachments: false,
        maxAttachmentMb: 1,
        intervalMin: 60,
      })
    );
    expect(notMine?.status).toBe(404);
  });

  it('stops syncing, but keeps the mail, when the mailbox is removed', async () => {
    await deleteUserIntegration(integrationId);
    integrationId = '';
    expect((await getSource()).status).toBe(EmailSourceStatus.Disconnected);
    expect((await getError(() => syncEmailSource(baseId, source.id)))?.status).toBe(400);
    expect((await recordsBySubject()).size).toBe(2);
  });
});

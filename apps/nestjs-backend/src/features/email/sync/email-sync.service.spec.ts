/* eslint-disable @typescript-eslint/no-explicit-any, sonarjs/no-duplicate-string */
import type { DataPrismaService } from '@teable/db-data-prisma';
import type { EmailMessage, EmailSource, PrismaService } from '@teable/db-main-prisma';
import knex from 'knex';
import type { ClsService } from 'nestjs-cls';
import { mockDeep } from 'vitest-mock-extended';
import type { CacheService } from '../../../cache/cache.service';
import type { IClsStore } from '../../../types/cls';
import type { AttachmentsService } from '../../attachments/attachments.service';
import type { NotificationService } from '../../notification/notification.service';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { UserIntegrationService } from '../../user-integration/user-integration.service';
import type { IFolderPage, IObservedMessage } from '../adapters/email-adapter.types';
import { buildEmailTableTemplate } from '../email-table.template';
import type { ISyncContext } from './email-sync.service';
import { EmailSyncService } from './email-sync.service';

/** Enough of Prisma's `where` for the queries the sync service makes. */
const matches = (row: Record<string, any>, where: Record<string, any> = {}) =>
  Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition === null || typeof condition !== 'object') return value === condition;
    if ('in' in condition) return condition.in.includes(value);
    if ('notIn' in condition) return !condition.notIn.includes(value);
    if ('startsWith' in condition) return String(value).startsWith(condition.startsWith);
    if ('not' in condition) return value !== condition.not;
    return true;
  });

const eml = (subject: string, messageId: string, extra: string[] = []) =>
  Buffer.from(
    [
      `From: a@example.com`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      ...extra,
      '',
      'body',
    ].join('\r\n')
  );

const message = (
  id: string,
  raw: Buffer,
  extra: Partial<IObservedMessage> = {}
): IObservedMessage => ({
  providerMessageId: id,
  folder: 'Inbox',
  load: vi.fn(async () => ({ raw })),
  ...extra,
});

const page = (overrides: Partial<IFolderPage>): IFolderPage => ({
  messages: [],
  deleted: [],
  cursor: 'c',
  hasMore: false,
  isBackfill: false,
  ...overrides,
});

describe('EmailSyncService.applyPage', () => {
  const prisma = mockDeep<PrismaService>();
  const dataPrisma = mockDeep<DataPrismaService>();
  const records = mockDeep<RecordOpenApiService>();
  const attachments = mockDeep<AttachmentsService>();
  const { fieldMap } = buildEmailTableTemplate('UTC');
  let rows: EmailMessage[];
  let existingRecords: Set<string>;
  let service: EmailSyncService;
  let ctx: ISyncContext;

  const createdFields = () =>
    records.createRecords.mock.calls.flatMap(([, ro]) => ro.records.map((r) => r.fields));
  const updatedRecords = () => records.updateRecords.mock.calls.flatMap(([, ro]) => ro.records);

  beforeEach(() => {
    vi.resetAllMocks();
    rows = [];
    existingRecords = new Set();
    const store = prisma.emailMessage;
    store.findMany.mockImplementation((async (args: any) =>
      rows.filter((r) => matches(r, args?.where))) as any);
    store.findFirst.mockImplementation(
      (async (args: any) => rows.find((r) => matches(r, args?.where)) ?? null) as any
    );
    store.update.mockImplementation((async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }) as any);
    store.updateMany.mockImplementation((async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }) as any);
    store.createMany.mockImplementation((async ({ data }: any) => {
      rows.push(...data.map((d: any) => ({ state: 'imported', ...d })));
      return { count: data.length };
    }) as any);
    records.createRecords.mockImplementation((async (_tableId: string, ro: any) => {
      ro.records.forEach((r: any) => existingRecords.add(r.id));
      return { records: [] };
    }) as any);
    dataPrisma.txClient.mockReturnValue({
      $queryRawUnsafe: vi.fn(async (sql: string) =>
        [...existingRecords].filter((id) => sql.includes(`'${id}'`)).map((id) => ({ __id: id }))
      ),
    } as any);
    attachments.uploadFile.mockImplementation((async (file: Express.Multer.File) => ({
      id: 'act1',
      name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      token: 't',
      size: file.size,
      mimetype: file.mimetype,
      path: 'p',
    })) as any);

    service = new EmailSyncService(
      prisma,
      dataPrisma,
      mockDeep<ClsService<IClsStore>>(),
      mockDeep<CacheService>(),
      mockDeep<UserIntegrationService>(),
      records,
      attachments,
      mockDeep<NotificationService>(),
      knex({ client: 'pg' })
    );
    ctx = {
      source: { id: 'ems1', tableId: 'tbl1' } as EmailSource,
      config: {
        folders: [{ id: 'INBOX', name: 'Inbox' }],
        since: null,
        maxMessages: 100,
        includeAttachments: false,
        maxAttachmentMb: 1,
        intervalMin: 5,
      },
      fieldMap,
      mailbox: 'me@example.com',
      dbTableName: 'bse1.emails',
      imported: 0,
      backfillBudget: 100,
      deadline: Date.now() + 60_000,
    };
  });

  it('imports new mail once, with its index row', async () => {
    await service.applyPage(
      ctx,
      page({ messages: [message('m1', eml('Hello', '<1@x>'), { isRead: true })] })
    );
    const [fields] = createdFields();
    expect(fields[fieldMap.subject]).toBe('Hello');
    expect(fields[fieldMap.is_read]).toBe(true);
    expect(fields[fieldMap.folders]).toEqual(['Inbox']);
    expect(fields[fieldMap.mailbox]).toBe('me@example.com');
    expect(rows).toEqual([
      expect.objectContaining({
        sourceId: 'ems1',
        providerMessageId: 'm1',
        internetMessageId: '<1@x>',
        state: 'imported',
        folders: '["Inbox"]',
      }),
    ]);
    expect(ctx.imported).toBe(1);

    // seen again: no second record
    const again = message('m1', eml('Hello', '<1@x>'), { isStarred: true });
    await service.applyPage(ctx, page({ messages: [again] }));
    expect(records.createRecords).toHaveBeenCalledTimes(1);
    expect(again.load).not.toHaveBeenCalled();
    expect(updatedRecords()).toEqual([
      { id: rows[0].recordId, fields: expect.objectContaining({ [fieldMap.is_starred]: true }) },
    ]);
  });

  it('treats the same Message-ID in another folder as the same email', async () => {
    await service.applyPage(ctx, page({ messages: [message('INBOX|1|5', eml('Hi', '<2@x>'))] }));
    await service.applyPage(
      ctx,
      page({ messages: [message('Work|1|9', eml('Hi', '<2@x>'), { folder: 'Work' })] })
    );
    expect(records.createRecords).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.recordId)).toEqual([rows[0].recordId, rows[0].recordId]);
    expect(updatedRecords().at(-1)?.fields[fieldMap.folders]).toEqual(['Inbox', 'Work']);
  });

  it('flags mail deleted at the provider once no folder still has it', async () => {
    await service.applyPage(ctx, page({ messages: [message('INBOX|1|5', eml('Hi', '<3@x>'))] }));
    await service.applyPage(
      ctx,
      page({ messages: [message('Work|1|9', eml('Hi', '<3@x>'), { folder: 'Work' })] })
    );
    const recordId = rows[0].recordId!;

    await service.applyPage(ctx, page({ deleted: ['INBOX|1|5'] }));
    expect(updatedRecords().at(-1)).toEqual({
      id: recordId,
      fields: expect.objectContaining({
        [fieldMap.folders]: ['Work'],
        [fieldMap.deleted_at_source]: null,
      }),
    });

    // gone from the last folder too, reported by presence (IMAP)
    await service.applyPage(ctx, page({ presence: { prefix: 'Work|1|', ids: [] } }));
    expect(updatedRecords().at(-1)?.fields).toMatchObject({
      [fieldMap.folders]: null,
      [fieldMap.deleted_at_source]: true,
    });
    expect(rows.every((r) => r.state === 'source_deleted')).toBe(true);
  });

  it('brings back mail that reappears, e.g. moved between folders', async () => {
    await service.applyPage(ctx, page({ messages: [message('g1', eml('Hi', '<4@x>'))] }));
    await service.applyPage(ctx, page({ deleted: ['g1'] }));
    await service.applyPage(
      ctx,
      page({ messages: [message('g1', eml('Hi', '<4@x>'), { folder: 'Archive' })] })
    );
    expect(rows[0]).toMatchObject({ state: 'imported', folders: '["Archive"]' });
    expect(updatedRecords().at(-1)?.fields).toMatchObject({
      [fieldMap.folders]: ['Archive'],
      [fieldMap.deleted_at_source]: null,
    });
  });

  it('never re-imports or updates a record a user deleted', async () => {
    await service.applyPage(ctx, page({ messages: [message('m1', eml('Hi', '<5@x>'))] }));
    existingRecords.clear();
    await service.applyPage(
      ctx,
      page({ messages: [message('m1', eml('Hi', '<5@x>'), { isRead: true })] })
    );
    expect(rows[0].state).toBe('user_deleted');
    expect(records.updateRecords).not.toHaveBeenCalled();

    // the same email under a new id (UIDVALIDITY reset) stays deleted too
    await service.applyPage(ctx, page({ messages: [message('m1-new', eml('Hi', '<5@x>'))] }));
    expect(records.createRecords).toHaveBeenCalledTimes(1);
    expect(rows[1]).toMatchObject({ providerMessageId: 'm1-new', state: 'user_deleted' });
  });

  it('stops the first import at the message limit', async () => {
    ctx.backfillBudget = 1;
    const second = message('m2', eml('B', '<b@x>'));
    await service.applyPage(
      ctx,
      page({ isBackfill: true, messages: [message('m1', eml('A', '<a@x>')), second] })
    );
    expect(createdFields()).toHaveLength(1);
    expect(second.load).not.toHaveBeenCalled();
    expect(ctx.backfillBudget).toBe(0);
  });

  it('skips a message that cannot be loaded and keeps going', async () => {
    const broken = message('bad', Buffer.from(''));
    vi.mocked(broken.load).mockRejectedValue(new Error('gone'));
    await service.applyPage(
      ctx,
      page({ messages: [broken, message('ok', eml('Fine', '<ok@x>'))] })
    );
    expect(createdFields().map((f) => f[fieldMap.subject])).toEqual(['Fine']);
    expect(rows.map((r) => r.providerMessageId)).toEqual(['ok']);
  });

  describe('attachments', () => {
    const withAttachments = eml('Files', '<f@x>', ['Content-Type: multipart/mixed; boundary="b"'])
      .toString()
      .replace(
        'body',
        [
          '--b',
          'Content-Type: text/plain',
          '',
          'see files',
          '--b',
          'Content-Type: text/plain; name="notes.txt"',
          'Content-Disposition: attachment; filename="notes.txt"',
          '',
          'small file',
          '--b',
          'Content-Type: application/octet-stream; name="big.bin"',
          'Content-Disposition: attachment; filename="big.bin"',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.alloc(2 * 1024 * 1024).toString('base64'),
          '--b--',
        ].join('\r\n')
      );

    it('uploads attachments under the size limit', async () => {
      ctx.config.includeAttachments = true;
      await service.applyPage(
        ctx,
        page({ messages: [message('m', Buffer.from(withAttachments))] })
      );
      expect(attachments.uploadFile).toHaveBeenCalledTimes(1);
      const [fields] = createdFields();
      expect(fields[fieldMap.attachments]).toEqual([
        expect.objectContaining({ name: 'notes.txt' }),
      ]);
      expect(fields[fieldMap.has_attachments]).toBe(true);
    });

    it('leaves them out when turned off', async () => {
      await service.applyPage(
        ctx,
        page({ messages: [message('m', Buffer.from(withAttachments))] })
      );
      expect(attachments.uploadFile).not.toHaveBeenCalled();
      const [fields] = createdFields();
      expect(fields).not.toHaveProperty(fieldMap.attachments);
      expect(fields[fieldMap.has_attachments]).toBe(true);
    });
  });
});

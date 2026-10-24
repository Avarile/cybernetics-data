/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import type { IAttachmentItem } from '@teable/core';
import {
  FieldKeyType,
  generateEmailMessageId,
  generateEmailSyncCursorId,
  generateRecordId,
} from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import type { EmailSource, UserIntegration } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type { IEmailFolder, IEmailSourceConfig } from '@teable/openapi';
import { EmailSourceStatus, UserIntegrationStatus } from '@teable/openapi';
import { isAxiosError } from 'axios';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { AttachmentsService } from '../../attachments/attachments.service';
import { NotificationService } from '../../notification/notification.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { describeMailServerError } from '../../user-integration/mail-server.tester';
import { UserIntegrationService } from '../../user-integration/user-integration.service';
import { createEmailAdapter } from '../adapters/create-email-adapter';
import type {
  IFolderPage,
  ILoadedMessage,
  IObservedMessage,
} from '../adapters/email-adapter.types';
import type { IEmailFieldKey, IEmailFieldMap } from '../email-table.template';
import { EMAIL_FIELD_TYPES } from '../email-table.template';
import type { IParsedEmail } from './email-parser';
import { parseEmail } from './email-parser';
import { toEmailRecordFields, toEmailStateFields } from './email-record.mapper';

export enum EmailMessageState {
  Imported = 'imported',
  UserDeleted = 'user_deleted',
  SourceDeleted = 'source_deleted',
}

const PAGE_SIZE = 25;
// one run is bounded so the account lock never outlives it; the rest continues in the next job
const MAX_IMPORTS_PER_RUN = 300;
const RUN_TIME_BUDGET_MS = 4 * 60_000;
const LOCK_TTL_SECONDS = 15 * 60;
const ERROR_MAX_LENGTH = 300;

export interface ISyncContext {
  source: EmailSource;
  config: IEmailSourceConfig;
  fieldMap: IEmailFieldMap;
  mailbox: string;
  dbTableName: string;
  imported: number;
  backfillBudget: number;
  deadline: number;
}

interface INewRecord {
  recordId: string;
  observed: IObservedMessage;
  parsed: IParsedEmail;
  folders: string[];
  fields: Record<string, unknown>;
}

interface ILoadedEmail {
  merged: IObservedMessage & ILoadedMessage;
  parsed: IParsedEmail;
  folders: string[];
  size: number;
}

interface IAlias {
  observed: IObservedMessage;
  messageId: string;
  folders: string[];
  recordId: string;
  state: string;
}

interface IStateObservation {
  isRead?: boolean;
  isStarred?: boolean;
}

const parseFolders = (value: string | null): string[] => {
  try {
    const folders = value ? JSON.parse(value) : [];
    return Array.isArray(folders) ? folders : [];
  } catch {
    return [];
  }
};

/** A short reason for the table header; details stay in the log. */
export const describeSyncError = (error: unknown): string => {
  if (error instanceof CustomHttpException) return error.message;
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401)
      return 'The mail provider rejected the authorization; reconnect the mailbox.';
    if (status === 403) return 'The mail provider denied access to this mailbox.';
    if (status === 429) return 'The mail provider is rate limiting requests; sync will retry.';
    if (status && status >= 500) return 'The mail provider is unavailable; sync will retry.';
    return 'Could not reach the mail provider; sync will retry.';
  }
  const err = error as { authenticationFailed?: boolean; code?: string; message?: string };
  if (err?.authenticationFailed || err?.code) return describeMailServerError(error);
  return `Sync failed: ${String(err?.message ?? error).slice(0, ERROR_MAX_LENGTH)}`;
};

/**
 * Pulls mail for one email table into its records. Runs as the table's creator (the mailbox
 * owner); one run per mail account at a time.
 */
@Injectable()
export class EmailSyncService {
  private readonly logger = new Logger(EmailSyncService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly dataPrismaService: DataPrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService,
    private readonly userIntegrationService: UserIntegrationService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly attachmentsService: AttachmentsService,
    private readonly notificationService: NotificationService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  /** @returns whether work is left for another run */
  async run(sourceId: string): Promise<boolean> {
    const source = await this.prismaService.emailSource.findUnique({ where: { id: sourceId } });
    if (
      !source ||
      source.deletedTime ||
      source.status === EmailSourceStatus.Paused ||
      source.status === EmailSourceStatus.Disconnected
    ) {
      return false;
    }
    const table = await this.prismaService.tableMeta.findUnique({
      where: { id: source.tableId },
      select: { deletedTime: true, dbTableName: true, name: true, baseId: true },
    });
    if (!table) {
      // the table was deleted for good
      await this.removeSource(source.id);
      return false;
    }
    if (table.deletedTime) {
      // in the trash: wait, a restore picks up where it left off
      return false;
    }
    const integration = await this.prismaService.userIntegration.findUnique({
      where: { id: source.integrationId },
    });
    if (!integration || integration.status === UserIntegrationStatus.NeedsReauth) {
      await this.fail(
        source,
        table,
        EmailSourceStatus.Disconnected,
        'Reconnect the mailbox to resume syncing.'
      );
      return false;
    }

    const lockKey = `lock:email-sync:${integration.id}` as const;
    if (!(await this.cacheService.setnx(lockKey, sourceId, LOCK_TTL_SECONDS))) {
      return false;
    }
    try {
      await this.prismaService.emailSource.update({
        where: { id: source.id },
        data: { status: EmailSourceStatus.Syncing },
      });
      const moreWork = await this.cls.run(async () => {
        this.cls.set('user.id', source.createdBy);
        this.cls.set('skipRecordAuditLog', true);
        return await this.syncSource(source, integration, table.dbTableName);
      });
      await this.prismaService.emailSource.update({
        where: { id: source.id },
        data: { status: EmailSourceStatus.Idle, lastSyncedTime: new Date(), lastError: null },
      });
      return moreWork;
    } catch (error) {
      this.logger.error(`Email sync ${source.id} failed: ${error}`, (error as Error)?.stack);
      const reauth = await this.prismaService.userIntegration.findUnique({
        where: { id: integration.id },
        select: { status: true },
      });
      const status =
        reauth?.status === UserIntegrationStatus.NeedsReauth
          ? EmailSourceStatus.Disconnected
          : EmailSourceStatus.Error;
      await this.fail(source, table, status, describeSyncError(error));
      return false;
    } finally {
      await this.cacheService.del(lockKey);
    }
  }

  private async fail(
    source: EmailSource,
    table: { name: string; baseId: string },
    status: EmailSourceStatus,
    message: string
  ) {
    await this.prismaService.emailSource.update({
      where: { id: source.id },
      data: { status, lastError: message.slice(0, ERROR_MAX_LENGTH) },
    });
    // tell the owner once, when a working table stops
    if (
      source.status !== EmailSourceStatus.Error &&
      source.status !== EmailSourceStatus.Disconnected
    ) {
      await this.notificationService
        .sendCommonNotify({
          path: `/base/${table.baseId}/table/${source.tableId}`,
          toUserId: source.createdBy,
          message: `Email sync for "${table.name}" stopped: ${message}`,
        })
        .catch((error) => this.logger.warn(`Could not notify about ${source.id}: ${error}`));
    }
  }

  private async removeSource(sourceId: string) {
    await this.prismaService.$tx(async (prisma) => {
      await prisma.emailMessage.deleteMany({ where: { sourceId } });
      await prisma.emailSyncCursor.deleteMany({ where: { sourceId } });
      await prisma.emailSource.delete({ where: { id: sourceId } });
    });
  }

  /** Managed fields that still exist with the type they were created with. */
  private async usableFieldMap(source: EmailSource): Promise<IEmailFieldMap> {
    const fieldMap = JSON.parse(source.fieldMap) as IEmailFieldMap;
    const fields = await this.prismaService.field.findMany({
      where: { tableId: source.tableId, deletedTime: null, id: { in: Object.values(fieldMap) } },
      select: { id: true, type: true, isLookup: true },
    });
    const usable = new Map(fields.filter((f) => !f.isLookup).map((f) => [f.id, f.type]));
    return Object.fromEntries(
      (Object.entries(fieldMap) as [IEmailFieldKey, string][]).filter(
        ([key, fieldId]) => usable.get(fieldId) === EMAIL_FIELD_TYPES[key]
      )
    );
  }

  private async importedCount(sourceId: string) {
    const query = this.knex('email_message')
      .countDistinct('record_id as count')
      .where('source_id', sourceId)
      .toQuery();
    const [row] = await this.prismaService.$queryRawUnsafe<{ count: number | bigint }[]>(query);
    return Number(row?.count ?? 0);
  }

  private async syncSource(
    source: EmailSource,
    integration: UserIntegration,
    dbTableName: string
  ): Promise<boolean> {
    const config = JSON.parse(source.config) as IEmailSourceConfig;
    const ctx: ISyncContext = {
      source,
      config,
      fieldMap: await this.usableFieldMap(source),
      mailbox: integration.address,
      dbTableName,
      imported: 0,
      backfillBudget: Math.max(0, config.maxMessages - (await this.importedCount(source.id))),
      deadline: Date.now() + RUN_TIME_BUDGET_MS,
    };
    await this.prismaService.emailSyncCursor.deleteMany({
      where: { sourceId: source.id, folderId: { notIn: config.folders.map((f) => f.id) } },
    });

    const adapter = createEmailAdapter(this.userIntegrationService.getMailAccess(integration));
    try {
      for (const folder of config.folders) {
        if (await this.syncFolder(ctx, adapter, folder)) {
          return true;
        }
      }
      return false;
    } finally {
      await adapter.close().catch(() => undefined);
    }
  }

  /** @returns whether the run budget ran out before the folder caught up */
  private async syncFolder(
    ctx: ISyncContext,
    adapter: ReturnType<typeof createEmailAdapter>,
    folder: IEmailFolder
  ) {
    const where = { sourceId_folderId: { sourceId: ctx.source.id, folderId: folder.id } };
    const row = await this.prismaService.emailSyncCursor.findUnique({ where });
    let cursor = row?.cursor ?? null;
    const since = ctx.config.since ? new Date(ctx.config.since) : null;
    for (;;) {
      if (ctx.imported >= MAX_IMPORTS_PER_RUN || Date.now() > ctx.deadline) {
        return true;
      }
      const page = await adapter.syncFolder(folder, cursor, {
        since,
        pageSize: PAGE_SIZE,
        backfillBudget: ctx.backfillBudget,
      });
      await this.applyPage(ctx, page);
      cursor = page.cursor;
      await this.prismaService.emailSyncCursor.upsert({
        where,
        create: {
          id: generateEmailSyncCursorId(),
          sourceId: ctx.source.id,
          folderId: folder.id,
          folderName: folder.name,
          cursor,
          lastSyncedTime: new Date(),
        },
        update: { cursor, folderName: folder.name, lastSyncedTime: new Date() },
      });
      if (!page.hasMore) {
        return false;
      }
    }
  }

  async applyPage(ctx: ISyncContext, page: IFolderPage) {
    const sourceId = ctx.source.id;
    const ids = page.messages.map((m) => m.providerMessageId);
    const known = ids.length
      ? await this.prismaService.emailMessage.findMany({
          where: { sourceId, providerMessageId: { in: ids } },
        })
      : [];
    const knownById = new Map(known.map((row) => [row.providerMessageId, row]));

    // record id -> latest read/starred state seen in this page
    const observations = new Map<string, IStateObservation>();
    const touched = new Set<string>();
    const observe = (recordId: string, m: { isRead?: boolean; isStarred?: boolean }) => {
      const previous = observations.get(recordId) ?? {};
      observations.set(recordId, {
        isRead: m.isRead ?? previous.isRead,
        isStarred: m.isStarred ?? previous.isStarred,
      });
      touched.add(recordId);
    };

    const fresh: IObservedMessage[] = [];
    for (const m of page.messages) {
      const row = knownById.get(m.providerMessageId);
      if (!row) {
        fresh.push(m);
      } else if (row.recordId && row.state !== EmailMessageState.UserDeleted) {
        await this.prismaService.emailMessage.update({
          where: { id: row.id },
          data: {
            state: EmailMessageState.Imported,
            folders: JSON.stringify(m.labels ?? [m.folder]),
          },
        });
        observe(row.recordId, m);
      }
    }

    await this.importFresh(ctx, page, fresh, observe);
    await this.markDeleted(ctx, page, touched);
    await this.updateRecordState(ctx, touched, observations);
  }

  private async importFresh(
    ctx: ISyncContext,
    page: IFolderPage,
    fresh: IObservedMessage[],
    observe: (recordId: string, m: IStateObservation) => void
  ) {
    const created: INewRecord[] = [];
    const pendingByMessageId = new Map<string, INewRecord>();
    const aliases: IAlias[] = [];

    for (const observed of fresh) {
      if (page.isBackfill && ctx.backfillBudget <= 0) break;
      const message = await this.loadMessage(observed);
      if (!message) continue;
      const { merged, parsed, folders } = message;

      // the same message under another id: another IMAP folder, or after a server renumbering
      const twin = parsed.messageId
        ? await this.findTwin(ctx.source.id, parsed.messageId, pendingByMessageId)
        : null;
      if (twin) {
        aliases.push({ observed: merged, messageId: parsed.messageId!, folders, ...twin });
        continue;
      }

      const record = await this.buildRecord(ctx, message);
      created.push(record);
      if (parsed.messageId) pendingByMessageId.set(parsed.messageId, record);
      if (page.isBackfill) ctx.backfillBudget--;
    }

    await this.saveCreated(ctx, created);
    await this.saveAliases(ctx, aliases, observe);
  }

  private async loadMessage(observed: IObservedMessage): Promise<ILoadedEmail | null> {
    try {
      const loaded = await observed.load();
      const parsed = await parseEmail(loaded.raw);
      return {
        merged: { ...observed, ...loaded },
        parsed,
        folders: loaded.labels ?? observed.labels ?? [observed.folder],
        size: loaded.size ?? loaded.raw.length,
      };
    } catch (error) {
      this.logger.warn(`Skipping message ${observed.providerMessageId}: ${error}`);
      return null;
    }
  }

  private async findTwin(
    sourceId: string,
    messageId: string,
    pending: Map<string, INewRecord>
  ): Promise<{ recordId: string; state: string } | null> {
    const created = pending.get(messageId);
    if (created) return { recordId: created.recordId, state: EmailMessageState.Imported };
    const row = await this.prismaService.emailMessage.findFirst({
      where: { sourceId, internetMessageId: messageId, recordId: { not: null } },
      select: { recordId: true, state: true },
    });
    return row ? { recordId: row.recordId!, state: row.state } : null;
  }

  private async buildRecord(ctx: ISyncContext, message: ILoadedEmail): Promise<INewRecord> {
    const { merged, parsed, folders, size } = message;
    const attachments = await this.uploadAttachments(ctx.config, parsed);
    return {
      recordId: generateRecordId(),
      observed: merged,
      parsed,
      folders,
      fields: toEmailRecordFields(
        {
          parsed,
          mailbox: ctx.mailbox,
          folders,
          isRead: merged.isRead,
          isStarred: merged.isStarred,
          threadId: merged.threadId,
          receivedAt: merged.receivedAt,
          size,
          attachments,
        },
        ctx.fieldMap
      ),
    };
  }

  private async saveCreated(ctx: ISyncContext, created: INewRecord[]) {
    if (!created.length) return;
    await this.recordOpenApiService.createRecords(
      ctx.source.tableId,
      {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: created.map(({ recordId, fields }) => ({ id: recordId, fields })),
      },
      true
    );
    await this.prismaService.emailMessage.createMany({
      data: created.map((record) => ({
        id: generateEmailMessageId(),
        sourceId: ctx.source.id,
        providerMessageId: record.observed.providerMessageId,
        internetMessageId: record.parsed.messageId ?? null,
        threadId: record.observed.threadId ?? null,
        recordId: record.recordId,
        folders: JSON.stringify(record.folders),
      })),
    });
    ctx.imported += created.length;
  }

  private async saveAliases(
    ctx: ISyncContext,
    aliases: IAlias[],
    observe: (recordId: string, m: IStateObservation) => void
  ) {
    if (!aliases.length) return;
    await this.prismaService.emailMessage.createMany({
      data: aliases.map((alias) => ({
        id: generateEmailMessageId(),
        sourceId: ctx.source.id,
        providerMessageId: alias.observed.providerMessageId,
        internetMessageId: alias.messageId,
        threadId: alias.observed.threadId ?? null,
        recordId: alias.recordId,
        folders: JSON.stringify(alias.folders),
        // a twin of a record the user deleted stays deleted
        state:
          alias.state === EmailMessageState.UserDeleted
            ? EmailMessageState.UserDeleted
            : EmailMessageState.Imported,
      })),
    });
    aliases
      .filter((alias) => alias.state !== EmailMessageState.UserDeleted)
      .forEach((alias) => observe(alias.recordId, alias.observed));
  }

  private async markDeleted(ctx: ISyncContext, page: IFolderPage, touched: Set<string>) {
    const sourceId = ctx.source.id;
    const deletedIds = new Set(page.deleted);
    if (page.presence) {
      const present = new Set(page.presence.ids);
      const rows = await this.prismaService.emailMessage.findMany({
        where: {
          sourceId,
          state: EmailMessageState.Imported,
          providerMessageId: { startsWith: page.presence.prefix },
        },
        select: { providerMessageId: true },
      });
      rows
        .filter((row) => !present.has(row.providerMessageId))
        .forEach((row) => deletedIds.add(row.providerMessageId));
    }
    if (!deletedIds.size) return;
    const rows = await this.prismaService.emailMessage.findMany({
      where: {
        sourceId,
        state: EmailMessageState.Imported,
        providerMessageId: { in: [...deletedIds] },
      },
      select: { id: true, recordId: true },
    });
    if (!rows.length) return;
    await this.prismaService.emailMessage.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { state: EmailMessageState.SourceDeleted },
    });
    rows.forEach((row) => row.recordId && touched.add(row.recordId));
  }

  /** Writes folders, read/starred and deleted_at_source for records whose messages changed. */
  private async updateRecordState(
    ctx: ISyncContext,
    touched: Set<string>,
    observations: Map<string, IStateObservation>
  ) {
    if (!touched.size) return;
    const recordIds = await this.existingRecordIds(ctx.dbTableName, [...touched]);
    const missing = [...touched].filter((id) => !recordIds.has(id));
    if (missing.length) {
      // deleted by a user: never import or update them again
      await this.prismaService.emailMessage.updateMany({
        where: { sourceId: ctx.source.id, recordId: { in: missing } },
        data: { state: EmailMessageState.UserDeleted },
      });
    }
    if (!recordIds.size) return;

    const rows = await this.prismaService.emailMessage.findMany({
      where: { sourceId: ctx.source.id, recordId: { in: [...recordIds] } },
      select: { recordId: true, state: true, folders: true },
    });
    const byRecord = new Map<string, typeof rows>();
    rows.forEach((row) =>
      byRecord.set(row.recordId!, [...(byRecord.get(row.recordId!) ?? []), row])
    );

    const records = [...recordIds].map((recordId) => {
      const live = (byRecord.get(recordId) ?? []).filter(
        (row) => row.state === EmailMessageState.Imported
      );
      const folders = [...new Set(live.flatMap((row) => parseFolders(row.folders)))];
      return {
        id: recordId,
        fields: toEmailStateFields(
          { ...observations.get(recordId), folders, deletedAtSource: live.length === 0 },
          ctx.fieldMap
        ),
      };
    });
    await this.recordOpenApiService.updateRecords(ctx.source.tableId, {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      records: records.filter((record) => Object.keys(record.fields).length),
    });
  }

  private async existingRecordIds(dbTableName: string, recordIds: string[]) {
    const query = this.knex(dbTableName).select('__id').whereIn('__id', recordIds).toQuery();
    const rows = await this.dataPrismaService.txClient().$queryRawUnsafe<{ __id: string }[]>(query);
    return new Set(rows.map((row) => row.__id));
  }

  private async uploadAttachments(
    config: IEmailSourceConfig,
    parsed: IParsedEmail
  ): Promise<IAttachmentItem[] | null> {
    if (!config.includeAttachments) return null;
    const maxBytes = config.maxAttachmentMb * 1024 * 1024;
    const items: IAttachmentItem[] = [];
    for (const attachment of parsed.attachments) {
      if (attachment.size > maxBytes) continue;
      try {
        items.push(
          await this.attachmentsService.uploadFile({
            buffer: attachment.content,
            size: attachment.size,
            mimetype: attachment.contentType,
            // uploadFile expects multer's latin1-decoded file name
            originalname: Buffer.from(attachment.filename, 'utf8').toString('latin1'),
          } as Express.Multer.File)
        );
      } catch (error) {
        this.logger.warn(`Skipping attachment ${attachment.filename}: ${error}`);
      }
    }
    return items;
  }
}

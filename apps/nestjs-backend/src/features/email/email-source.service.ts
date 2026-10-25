/* eslint-disable @typescript-eslint/naming-convention */
import { FieldKeyType, generateEmailSourceId, getUniqName, HttpErrorCode } from '@cybernetics/core';
import { Injectable, Logger } from '@nestjs/common';
import type { EmailSource } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateEmailTableRo,
  ICreateEmailTableVo,
  IEmailFolder,
  IEmailSourceConfig,
  IEmailSourceVo,
  IUpdateEmailSourceRo,
} from '@teable/openapi';
import { EmailSourceStatus, UserIntegrationProvider, UserIntegrationStatus } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { prepareCreateTableRo } from '../table/open-api/table.pipe.helper';
import { UserIntegrationService } from '../user-integration/user-integration.service';
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import { createEmailAdapter } from './adapters/create-email-adapter';
import { buildEmailTableTemplate } from './email-table.template';
import { EmailSyncQueueProcessor } from './sync/email-sync.processor';
import { describeSyncError, EmailMessageState } from './sync/email-sync.service';

const MAIL_PROVIDERS: string[] = [
  UserIntegrationProvider.Gmail,
  UserIntegrationProvider.Outlook,
  UserIntegrationProvider.Imap,
];

const sameFolders = (a: IEmailFolder[], b: IEmailFolder[]) =>
  a.length === b.length && a.every((folder, i) => folder.id === b[i].id);

/** Email tables: creating them, their sync settings, and what they can import. */
@Injectable()
export class EmailSourceService {
  private readonly logger = new Logger(EmailSourceService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly userIntegrationService: UserIntegrationService,
    private readonly syncProcessor: EmailSyncQueueProcessor,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  /** One of the caller's own mailboxes that can be read now. */
  private async getMailIntegration(integrationId: string) {
    const integration = await this.userIntegrationService.getOwned(integrationId);
    if (!MAIL_PROVIDERS.includes(integration.provider)) {
      throw new CustomHttpException(
        'This integration is not a mailbox',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    if (integration.status === UserIntegrationStatus.NeedsReauth) {
      throw new CustomHttpException(
        'Reconnect this mailbox before using it',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    return integration;
  }

  async listFolders(integrationId: string): Promise<IEmailFolder[]> {
    const integration = await this.getMailIntegration(integrationId);
    const adapter = createEmailAdapter(this.userIntegrationService.getMailAccess(integration));
    try {
      return await adapter.listFolders();
    } catch (error) {
      this.logger.warn(`Listing folders of ${integrationId} failed: ${error}`);
      throw new CustomHttpException(describeSyncError(error), HttpErrorCode.FAILED_DEPENDENCY);
    } finally {
      await adapter.close().catch(() => undefined);
    }
  }

  async createEmailTable(baseId: string, ro: ICreateEmailTableRo): Promise<ICreateEmailTableVo> {
    const integration = await this.getMailIntegration(ro.integrationId);
    const template = buildEmailTableTemplate(ro.timeZone ?? 'UTC');
    const existingNames = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { name: true },
    });
    const name = getUniqName(
      ro.name ?? `Emails · ${integration.address}`,
      existingNames.map((table) => table.name)
    );

    const table = await this.tableOpenApiService.createTable(
      baseId,
      prepareCreateTableRo({
        name,
        icon: '📧',
        description: `Mail from ${integration.address}, synced automatically.`,
        fieldKeyType: FieldKeyType.Id,
        fields: template.fields,
        views: template.views,
        records: [],
      })
    );

    try {
      for (const view of table.views) {
        await this.viewOpenApiService.updateViewColumnMeta(
          table.id,
          view.id,
          template.hiddenFieldIds.map((fieldId) => ({ fieldId, columnMeta: { hidden: true } }))
        );
      }
      const config: IEmailSourceConfig = {
        folders: ro.folders,
        since: ro.since,
        maxMessages: ro.maxMessages,
        includeAttachments: ro.includeAttachments,
        maxAttachmentMb: ro.maxAttachmentMb,
        intervalMin: ro.intervalMin,
      };
      const source = await this.prismaService.emailSource.create({
        data: {
          id: generateEmailSourceId(),
          baseId,
          tableId: table.id,
          integrationId: integration.id,
          fieldMap: JSON.stringify(template.fieldMap),
          config: JSON.stringify(config),
          status: EmailSourceStatus.Idle,
          createdBy: this.cls.get('user.id'),
        },
      });
      await this.syncProcessor.enqueue(source.id);
      return {
        sourceId: source.id,
        tableId: table.id,
        defaultViewId: table.defaultViewId ?? table.views[0].id,
      };
    } catch (error) {
      await this.tableOpenApiService
        .permanentDeleteTables(baseId, [table.id])
        .catch((cleanupError) =>
          this.logger.error(`Cleanup of ${table.id} failed: ${cleanupError}`)
        );
      throw error;
    }
  }

  private async getSource(baseId: string, sourceId: string) {
    const source = await this.prismaService.emailSource.findFirst({
      where: { id: sourceId, baseId, deletedTime: null },
    });
    if (!source) {
      throw new CustomHttpException('Email table not found', HttpErrorCode.NOT_FOUND);
    }
    return source;
  }

  private async toVos(sources: EmailSource[]): Promise<IEmailSourceVo[]> {
    if (!sources.length) return [];
    const integrations = await this.prismaService.userIntegration.findMany({
      where: { id: { in: [...new Set(sources.map((s) => s.integrationId))] } },
      select: { id: true, provider: true, address: true },
    });
    const byId = new Map(integrations.map((i) => [i.id, i]));
    const countQuery = this.knex('email_message')
      .select('source_id')
      .countDistinct('record_id as count')
      .whereIn(
        'source_id',
        sources.map((s) => s.id)
      )
      .whereNot('state', EmailMessageState.UserDeleted)
      .groupBy('source_id')
      .toQuery();
    const counts =
      await this.prismaService.$queryRawUnsafe<{ source_id: string; count: number | bigint }[]>(
        countQuery
      );
    const countById = new Map(counts.map((row) => [row.source_id, Number(row.count)]));

    return sources.map((source) => ({
      id: source.id,
      baseId: source.baseId,
      tableId: source.tableId,
      integrationId: source.integrationId,
      provider: byId.get(source.integrationId)?.provider,
      address: byId.get(source.integrationId)?.address,
      status: source.status as EmailSourceStatus,
      config: JSON.parse(source.config),
      lastSyncedTime: source.lastSyncedTime?.toISOString(),
      lastError: source.lastError ?? undefined,
      createdBy: source.createdBy,
      createdTime: source.createdTime.toISOString(),
      messageCount: countById.get(source.id) ?? 0,
    }));
  }

  async listSources(baseId: string): Promise<IEmailSourceVo[]> {
    const sources = await this.prismaService.emailSource.findMany({
      where: { baseId, deletedTime: null },
      orderBy: { createdTime: 'asc' },
    });
    return this.toVos(sources);
  }

  async updateSource(
    baseId: string,
    sourceId: string,
    ro: IUpdateEmailSourceRo
  ): Promise<IEmailSourceVo> {
    const source = await this.getSource(baseId, sourceId);
    const config = JSON.parse(source.config) as IEmailSourceConfig;
    // collaborators may tune syncing, but which folders of a mailbox are shared is its owner's call
    if (
      ro.folders &&
      !sameFolders(ro.folders, config.folders) &&
      source.createdBy !== this.cls.get('user.id')
    ) {
      throw new CustomHttpException(
        'Only the owner of the mailbox can change which folders are imported',
        HttpErrorCode.RESTRICTED_RESOURCE
      );
    }
    const { paused, ...changes } = ro;
    const nextConfig: IEmailSourceConfig = { ...config, ...changes };

    let status = source.status;
    if (paused === true) {
      status = EmailSourceStatus.Paused;
    } else if (paused === false && source.status === EmailSourceStatus.Paused) {
      status = EmailSourceStatus.Idle;
    }
    const updated = await this.prismaService.emailSource.update({
      where: { id: source.id },
      data: { config: JSON.stringify(nextConfig), status },
    });
    if (status === EmailSourceStatus.Idle && source.status === EmailSourceStatus.Paused) {
      await this.syncProcessor.enqueue(source.id);
    }
    const [vo] = await this.toVos([updated]);
    return vo;
  }

  async syncNow(baseId: string, sourceId: string) {
    const source = await this.getSource(baseId, sourceId);
    if (source.status === EmailSourceStatus.Paused) {
      throw new CustomHttpException('Resume syncing first', HttpErrorCode.VALIDATION_ERROR);
    }
    if (source.status === EmailSourceStatus.Disconnected) {
      throw new CustomHttpException(
        'The mailbox owner has to reconnect it first',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    await this.syncProcessor.enqueue(source.id);
  }
}

import type { Readable } from 'stream';
import { CellFormat, FieldKeyType } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import { detectTableProfile } from '../../../ai-data/ai-data.schema';
import type { IAiDataFieldSummary } from '../../../ai-data/ai-data.schema';
import StorageAdapter from '../../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../../attachments/plugins/storage';
import { ChatFileService } from '../../../chat-file/chat-file.service';
import { RecordService } from '../../../record/record.service';
import {
  AGENT_LAYOUT_PORT,
  AGENT_STORE_PORT,
  HTTP_PORT,
  type IAgentLayoutPort,
  type IAgentStorePort,
  type IHttpPort,
  type IRagSource,
  type IRagSourceReaderPort,
  type IRagSourceText,
} from '../../domain/ports';
import { AGENT_TABLES } from '../../pack/agent-pack';
import { recordText } from './record-text';
import { htmlToText, looksMarkdown } from './text-extract';

const streamToBuffer = (stream: Readable) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });

/**
 * Reads the text of a knowledge source (design §11.3): pasted text, a chat file or attachment
 * (pdf, docx, html, md, csv via the chat-file parsers), a URL through the agent's outbound HTTP
 * guard, or records of a table (read with their text cells, as the UI shows them) or of
 * agent_memory.
 */
@Injectable()
export class RagSourceReader implements IRagSourceReaderPort {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly chatFiles: ChatFileService,
    private readonly recordService: RecordService,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @Inject(HTTP_PORT) private readonly http: IHttpPort,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(AGENT_LAYOUT_PORT) private readonly layout: IAgentLayoutPort
  ) {}

  async read(source: IRagSource, collectionId?: string): Promise<IRagSourceText | undefined> {
    switch (source.kind) {
      case 'text':
        return {
          title: null,
          text: source.text,
          format: looksMarkdown(source.text) ? 'markdown' : 'text',
        };
      case 'attachment':
        return this.readAttachment(source.token);
      case 'url':
        return this.readUrl(source.url);
      case 'record':
        return (
          await this.readRecords(source.tableId, [source.recordId], collectionId ?? 'kb_records')
        ).get(source.recordId);
    }
  }

  private async decode(buffer: Buffer, mimetype: string, title: string | null) {
    const text = await this.chatFiles.extractTextFromBuffer(buffer, mimetype);
    if (/html/i.test(mimetype)) {
      const page = htmlToText(text);
      return { title: title ?? page.title, text: page.text, format: 'text' as const };
    }
    return { title, text, format: looksMarkdown(text) ? ('markdown' as const) : ('text' as const) };
  }

  private async readAttachment(token: string) {
    const chatFile = await this.prismaService.chatFile.findFirst({
      where: { token, deletedTime: null },
    });
    if (chatFile) {
      const bucket = StorageAdapter.getBucket(UploadType.ChatFile);
      const buffer = await streamToBuffer(
        (await this.storageAdapter.downloadFile(bucket, chatFile.path)) as Readable
      );
      return this.decode(buffer, chatFile.mimetype, chatFile.name);
    }
    const attachment = await this.prismaService.attachments.findFirst({
      where: { token, deletedTime: null },
    });
    if (!attachment) return undefined;
    const bucket = StorageAdapter.getBucket(UploadType.Table);
    const buffer = await streamToBuffer(
      (await this.storageAdapter.downloadFile(bucket, attachment.path)) as Readable
    );
    return this.decode(buffer, attachment.mimetype, null);
  }

  private async readUrl(url: string) {
    const res = await this.http.request({ method: 'GET', url });
    if (res.location) throw new Error(`${url} redirects to ${res.location}; ingest that URL`);
    if (res.status >= 400) throw new Error(`${url} answered ${res.status}`);
    const type = res.headers['content-type'] ?? '';
    if (/html/i.test(type) || /^\s*<(?:!doctype|html)/i.test(res.body)) {
      const page = htmlToText(res.body);
      return { title: page.title ?? url, text: page.text, format: 'text' as const };
    }
    return {
      title: url,
      text: res.body,
      format: looksMarkdown(res.body) ? ('markdown' as const) : ('text' as const),
    };
  }

  async readRecords(tableId: string, recordIds: string[], collectionId: string) {
    const out = new Map<string, IRagSourceText | undefined>();
    if (!recordIds.length) return out;
    const { tableMap } = await this.layout.layout();
    if (tableMap[AGENT_TABLES.memory] === tableId) {
      for (const id of recordIds) {
        const memory = await this.store.getMemory(id).catch(() => undefined);
        out.set(
          id,
          memory?.isActive
            ? { title: memory.title, text: memory.content ?? '', format: 'record' }
            : undefined
        );
      }
      return out;
    }

    const table = await this.tableFields(tableId);
    // the record service's own reader, without the per-user permission and rate limits of the
    // interactive tools: a sync reads thousands of records
    const snapshots = await this.recordService
      .getSnapshotBulk(tableId, recordIds, undefined, FieldKeyType.Id, CellFormat.Text)
      .catch(() => []);
    const cells = new Map(snapshots.map((s) => [s.data.id, s.data.fields]));
    const mode = collectionId === 'records' ? 'records' : 'knowledge';
    for (const id of recordIds) {
      const fields = cells.get(id);
      out.set(id, fields ? recordText(table.fields, table.profile, fields, mode) : undefined);
    }
    return out;
  }

  /**
   * Fields and profile of a table, straight from the schema, once per batch (not cached: a sync
   * after a rename must see the new names). Not through the AI data service: its per-user rate
   * limit is for interactive tools, and a full sync reads thousands of records.
   */
  private async tableFields(tableId: string) {
    const rows = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, name: true, type: true, isPrimary: true, isComputed: true },
      orderBy: { order: 'asc' },
    });
    const fields: IAiDataFieldSummary[] = rows.map((f) => ({
      ...f,
      isPrimary: Boolean(f.isPrimary),
      isComputed: Boolean(f.isComputed),
    }));
    return { fields, profile: detectTableProfile(fields) };
  }
}

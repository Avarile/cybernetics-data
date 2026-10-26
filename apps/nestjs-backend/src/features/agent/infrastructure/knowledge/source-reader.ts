import type { Readable } from 'stream';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import type { IAiDataFieldSummary, IAiDataTableProfile } from '../../../ai-data/ai-data.schema';
import StorageAdapter from '../../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../../attachments/plugins/storage';
import { ChatFileService } from '../../../chat-file/chat-file.service';
import { RecordService } from '../../../record/record.service';
import {
  AGENT_LAYOUT_PORT,
  AGENT_STORE_PORT,
  DATA_GATEWAY_PORT,
  HTTP_PORT,
  type IAgentLayoutPort,
  type IAgentStorePort,
  type IDataGatewayPort,
  type IHttpPort,
  type IRagSource,
  type IRagSourceReaderPort,
  type IRagSourceText,
} from '../../domain/ports';
import { AGENT_TABLES } from '../../pack/agent-pack';
import { cellText, htmlToText, looksMarkdown } from './text-extract';

const textTypes = new Set(['singleLineText', 'longText', 'singleSelect', 'multipleSelect']);

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
 * guard, or a record of a knowledge table or of agent_memory.
 */
@Injectable()
export class RagSourceReader implements IRagSourceReaderPort {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly chatFiles: ChatFileService,
    private readonly recordService: RecordService,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @Inject(HTTP_PORT) private readonly http: IHttpPort,
    @Inject(DATA_GATEWAY_PORT) private readonly data: IDataGatewayPort,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(AGENT_LAYOUT_PORT) private readonly layout: IAgentLayoutPort
  ) {}

  async read(source: IRagSource): Promise<IRagSourceText | undefined> {
    switch (source.kind) {
      case 'text':
      case 'legacy':
        return {
          title: source.kind === 'legacy' ? source.docName : null,
          text: source.text,
          format: looksMarkdown(source.text) ? 'markdown' : 'text',
        };
      case 'attachment':
        return this.readAttachment(source.token);
      case 'url':
        return this.readUrl(source.url);
      case 'record':
        return this.readRecord(source.baseId, source.tableId, source.recordId);
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

  private async readRecord(baseId: string, tableId: string, recordId: string) {
    const { tableMap } = await this.layout.layout();
    if (tableMap[AGENT_TABLES.memory] === tableId) {
      const memory = await this.store.getMemory(recordId).catch(() => undefined);
      if (!memory?.isActive) return undefined;
      return { title: memory.title, text: memory.content ?? '', format: 'record' as const };
    }

    const table = (await this.data.describeTable({ baseId, table: tableId })) as {
      profile: IAiDataTableProfile;
      fields: IAiDataFieldSummary[];
    };
    const record = await this.recordService
      .getRecordsById(tableId, [recordId], false)
      .then((r) => r.records[0])
      .catch(() => undefined);
    if (!record) return undefined;
    const { titleFieldId, contextFieldId, softDeleteFieldId } = table.profile;
    if (softDeleteFieldId && record.fields[softDeleteFieldId]) return undefined;

    const title = titleFieldId ? cellText(record.fields[titleFieldId]) || null : null;
    // the context field when there is one; otherwise every other text field, by name
    const text = contextFieldId
      ? cellText(record.fields[contextFieldId])
      : table.fields
          .filter((f) => f.id !== titleFieldId && textTypes.has(f.type))
          .map((f) => [f.name, cellText(record.fields[f.id])])
          .filter(([, v]) => v)
          .map(([name, v]) => `${name}: ${v}`)
          .join('\n\n');
    return { title, text, format: 'record' as const };
  }
}

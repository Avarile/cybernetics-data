import { createHash } from 'crypto';
import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { COCKPIT_SEARCH_TAKE, SUMMARY_MIN_CHARS } from '@teable/openapi';
import type { ICockpitRecordVo, ICockpitSearchVo, ICockpitSummaryVo } from '@teable/openapi';
import { generateText } from 'ai';
import { CustomHttpException } from '../../../../custom.exception';
import { recordMarkdown } from '../../domain/cockpit/record-markdown';
import { snippetOf } from '../../domain/cockpit/snippet';
import { SUMMARY_SYSTEM, spokenText, summaryPrompt } from '../../domain/cockpit/summary-prompt';
import {
  AGENT_LAYOUT_PORT,
  AGENT_STORE_PORT,
  AUDIT_PORT,
  COCKPIT_DATA_PORT,
  MODEL_PORT,
  SCHEMA_CATALOG_PORT,
  type IAgentLayoutPort,
  type IAgentStorePort,
  type IAuditPort,
  type ICockpitDataPort,
  type IModelPort,
  type ISchemaCatalogPort,
} from '../../domain/ports';
import { redact } from '../../domain/redact';
import { cockpitNotFound } from './cockpit-scope';

/** Summaries kept, and for how long: an unchanged record is never summarised twice in a row. */
export const SUMMARY_CACHE_SIZE = 200;
export const SUMMARY_CACHE_MS = 10 * 60_000;

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

/**
 * Scope design §7, §8: the cockpit's table search (the table page's Search, table-wide, every
 * field), a record as Markdown for its reader, and the agent's spoken summary of a long record.
 * Everything is read as the admin, with access checked on every call.
 */
@Injectable()
export class CockpitRecords {
  private readonly logger = new Logger(CockpitRecords.name);
  private readonly summaries = new Map<string, { at: number; summary: string; model: string }>();

  constructor(
    @Inject(COCKPIT_DATA_PORT) private readonly data: ICockpitDataPort,
    @Inject(SCHEMA_CATALOG_PORT) private readonly catalog: ISchemaCatalogPort,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(AGENT_LAYOUT_PORT) private readonly layout: IAgentLayoutPort,
    @Inject(MODEL_PORT) private readonly models: IModelPort,
    @Inject(AUDIT_PORT) private readonly audit: IAuditPort
  ) {}

  /** The table with its fields, once the admin may read its records. */
  private async tableOf(tableId: string) {
    const meta = await this.data.table(tableId);
    if (!meta) throw cockpitNotFound('Table');
    await this.data.assertAllowed(meta.baseId, ['record|read']);
    const schema = await this.catalog.schema(meta.baseId);
    const table = schema.tables.find((t) => t.id === tableId);
    if (!table) throw cockpitNotFound('Table');
    return { table, excluded: schema.excluded.has(tableId) };
  }

  async search(tableId: string, q: string, take = COCKPIT_SEARCH_TAKE): Promise<ICockpitSearchVo> {
    const { table } = await this.tableOf(tableId);
    const primary = table.fields.find((f) => f.isPrimary);
    const { records, total } = await this.data.search(tableId, q, take);
    return {
      tableId,
      q,
      total,
      results: records.map((r) => ({
        recordId: r.id,
        title: (primary && r.cells[primary.id]?.trim()) || '(untitled)',
        snippet: snippetOf(table.fields, r.cells, q),
        updatedAt: r.lastModifiedTime ?? null,
      })),
    };
  }

  async read(tableId: string, recordId: string): Promise<ICockpitRecordVo> {
    const { table } = await this.tableOf(tableId);
    const row = await this.data.readRecord(tableId, recordId);
    if (!row) throw cockpitNotFound('Record');
    const md = recordMarkdown(table, row.cells, row.lastModifiedTime);
    return {
      tableId,
      tableName: table.name,
      baseId: table.baseId,
      recordId,
      title: md.title,
      markdown: md.markdown,
      chars: md.chars,
      version: row.lastModifiedTime ?? sha1(md.markdown).slice(0, 16),
      masked: md.masked,
    };
  }

  async summarize(actorUserId: string, tableId: string, recordId: string) {
    const { excluded } = await this.tableOf(tableId);
    if (excluded) {
      throw new CustomHttpException(
        'This table is excluded from the agent (search_exclude): it is not sent to the model',
        HttpErrorCode.CONFLICT
      );
    }
    const record = await this.read(tableId, recordId);
    if (record.chars <= SUMMARY_MIN_CHARS) {
      throw new CustomHttpException(
        `Only records longer than ${SUMMARY_MIN_CHARS} characters are summarised`,
        HttpErrorCode.UNPROCESSABLE_ENTITY
      );
    }
    const key = `${recordId}:${sha1(record.markdown)}`;
    const hit = this.summaries.get(key);
    if (hit && Date.now() - hit.at < SUMMARY_CACHE_MS) {
      return { summary: hit.summary, model: hit.model, cached: true } satisfies ICockpitSummaryVo;
    }
    const started = Date.now();
    const { ref, model } = await this.model();
    try {
      const { text } = await generateText({
        model,
        system: SUMMARY_SYSTEM,
        prompt: summaryPrompt(record.markdown),
        maxOutputTokens: 400,
      });
      const summary = spokenText(text);
      this.remember(key, { at: Date.now(), summary, model: ref });
      await this.log(actorUserId, { tableId, recordId }, 'ok', started, ref);
      return { summary, model: ref, cached: false } satisfies ICockpitSummaryVo;
    } catch (error) {
      const message = String(redact((error as Error)?.message ?? error));
      this.logger.warn(`Summary of ${recordId} failed: ${message}`);
      await this.log(actorUserId, { tableId, recordId }, 'error', started, message);
      throw new CustomHttpException(
        `The model could not summarise: ${message}`,
        HttpErrorCode.CONFLICT
      );
    }
  }

  /** The small model, else the chat model, of a healthy agent (409 otherwise). */
  private async model() {
    await this.layout.layout();
    const profile = await this.store.getDefaultProfile();
    const ref = profile?.smallModel || profile?.model;
    if (!ref) {
      throw new CustomHttpException(
        'The agent has no model: set one in Admin ▸ Agent',
        HttpErrorCode.CONFLICT
      );
    }
    return { ref, model: (await this.models.resolve(ref)).model };
  }

  private remember(key: string, entry: { at: number; summary: string; model: string }) {
    this.summaries.delete(key);
    this.summaries.set(key, entry);
    while (this.summaries.size > SUMMARY_CACHE_SIZE)
      this.summaries.delete(this.summaries.keys().next().value!);
  }

  private log(
    actorUserId: string,
    args: { tableId: string; recordId: string },
    status: 'ok' | 'error',
    started: number,
    resultSummary: string
  ) {
    return this.audit
      .append({
        runId: 'cockpit',
        actorUserId,
        tool: 'cockpit.summary',
        args,
        resultSummary,
        status,
        durationMs: Date.now() - started,
      })
      .catch(() => undefined);
  }
}

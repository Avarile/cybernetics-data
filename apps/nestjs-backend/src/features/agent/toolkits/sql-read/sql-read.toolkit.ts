import { HttpErrorCode } from '@cybernetics/core';
import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { z } from 'zod';
import { CustomHttpException } from '../../../../custom.exception';
import { BaseSqlExecutorService } from '../../../base-sql-executor/base-sql-executor.service';
import { ToolkitRegistry } from '../toolkit.registry';
import type { IToolkit } from '../toolkit.types';
import { defineTool } from '../toolkit.types';

export const MAX_SQL_ROWS = 200;
const maxSqlChars = 20_000;

/** A query runs at most this long. */
export const SQL_TIMEOUT_MS = 15_000;

/**
 * The query inside a row limit; only one statement, no trailing semicolons. The body stands on
 * its own lines, so a trailing `-- comment` cannot comment out the limit, and an unclosed `/*`
 * is refused for the same reason.
 */
export function limitedSql(sql: string, limit = MAX_SQL_ROWS + 1) {
  const body = sql
    .trim()
    .replace(/;+\s*$/, '')
    .trim();
  if (!body) throw new CustomHttpException('The query is empty', HttpErrorCode.VALIDATION_ERROR);
  if (body.includes(';')) {
    throw new CustomHttpException('Send one statement at a time', HttpErrorCode.VALIDATION_ERROR);
  }
  if (body.lastIndexOf('/*') > body.lastIndexOf('*/')) {
    throw new CustomHttpException('Close the /* comment', HttpErrorCode.VALIDATION_ERROR);
  }
  return `select * from (\n${body}\n) as agent_query limit ${limit}`;
}

/** JSON-safe rows (counts come back as BigInt). */
export const jsonRows = (rows: Record<string, unknown>[]) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
    )
  );

/**
 * sql_read (design §8): read-only SQL on one base through BaseSqlExecutorService, which allows
 * only the base's tables and runs under the base's read-only database role.
 */
@Injectable()
export class SqlReadToolkit implements IToolkit, OnModuleInit {
  readonly id = 'sql_read' as const;
  readonly title = 'Read-only SQL';
  readonly tools;

  constructor(
    private readonly registry: ToolkitRegistry,
    private readonly prismaService: PrismaService,
    private readonly executor: BaseSqlExecutorService
  ) {
    const baseId = z.string().startsWith('bse').describe('base id (bse…)');
    this.tools = [
      defineTool({
        name: 'sql_tables',
        description:
          'Database names of the tables and columns of a base, for sql_query. Use the quoted db names, e.g. "bse1"."tbl1"."amount".',
        input: z.object({ baseId }),
        untrusted: true,
        execute: async (i) => this.schema(i.baseId),
      }),
      defineTool({
        name: 'sql_query',
        description: `Run one read-only SELECT on a base (PostgreSQL). At most ${MAX_SQL_ROWS} rows come back; aggregate in SQL for more.`,
        input: z.object({ baseId, sql: z.string().min(1).max(maxSqlChars) }),
        untrusted: true,
        execute: async (i) => {
          const rows = (await this.executor.executeQuerySql<Record<string, unknown>[]>(
            i.baseId,
            limitedSql(i.sql),
            { timeoutMs: SQL_TIMEOUT_MS }
          )) as Record<string, unknown>[];
          const truncated = rows.length > MAX_SQL_ROWS;
          return {
            rows: jsonRows(rows.slice(0, MAX_SQL_ROWS)),
            returned: Math.min(rows.length, MAX_SQL_ROWS),
            truncated,
          };
        },
      }),
    ];
  }

  onModuleInit() {
    this.registry.register(this);
  }

  private async schema(baseId: string) {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true, name: true, dbTableName: true },
    });
    const fields = await this.prismaService.field.findMany({
      where: { tableId: { in: tables.map((t) => t.id) }, deletedTime: null },
      select: { tableId: true, name: true, dbFieldName: true, type: true },
    });
    return {
      tables: tables.map((t) => ({
        table: t.name,
        dbTableName: t.dbTableName,
        columns: [
          { field: '(record id)', column: '__id', type: 'text' },
          ...fields
            .filter((f) => f.tableId === t.id)
            .map((f) => ({ field: f.name, column: f.dbFieldName, type: f.type })),
        ],
      })),
    };
  }
}

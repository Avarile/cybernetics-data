/* eslint-disable sonarjs/no-duplicate-string */
/**
 * sql_read (design §8): read-only SQL on one base, through the base's read-only role and table
 * allow-list; at most 200 rows.
 */
import { FieldType } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { SqlReadToolkit } from '../src/features/agent/toolkits/sql-read/sql-read.toolkit';
import type { IToolContext } from '../src/features/agent/toolkits/toolkit.types';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { initApp } from './utils/init-app';

describe('Agent sql_read (e2e)', () => {
  let app: INestApplication;
  let member: AxiosInstance;
  let spaceId: string;
  let baseId: string;
  let otherBaseId: string;
  const run = async <T = Record<string, unknown>>(name: string, input: unknown) => {
    const t = app.get(SqlReadToolkit).tools.find((x) => x.name === name)!;
    return (await app
      .get(AgentExecutionContext)
      .run({ runId: 'e2e-sql', actorUserId: globalThis.testConfig.userId }, () =>
        (t.execute as (i: unknown, c: IToolContext) => Promise<unknown>)(
          t.input.parse(input),
          {} as IToolContext
        )
      )) as T;
  };

  beforeAll(async () => {
    app = (await initApp()).app;
    member = await createNewUserAxios({
      email: 'agent-sql-owner@example.com',
      password: '12345678',
    });
    spaceId = (await member.post('/space', { name: 'Analytics' })).data.id;
    baseId = (await member.post('/base', { spaceId, name: 'Orders' })).data.id;
    otherBaseId = (await member.post('/base', { spaceId, name: 'Other' })).data.id;
    await member.post(`/base/${baseId}/table/`, {
      name: 'Orders',
      fields: [
        { name: 'Customer', type: FieldType.SingleLineText },
        { name: 'Total', type: FieldType.Number },
      ],
      records: Array.from({ length: 250 }, (_, i) => ({
        fields: { Customer: i % 2 ? 'Acme' : 'Globex', Total: i + 1 },
      })),
    });
    await member.post(`/base/${otherBaseId}/table/`, {
      name: 'Secret',
      fields: [{ name: 'X', type: FieldType.SingleLineText }],
    });
  });

  afterAll(async () => {
    await member.delete(`/space/${spaceId}`);
    await app.close();
  });

  const orders = async () => {
    const { tables } = await run<{
      tables: {
        table: string;
        dbTableName: string;
        columns: { field: string; column: string }[];
      }[];
    }>('sql_tables', { baseId });
    const t = tables.find((x) => x.table === 'Orders')!;
    const col = (name: string) => t.columns.find((c) => c.field === name)!.column;
    const quoted = t.dbTableName
      .split('.')
      .map((p) => `"${p}"`)
      .join('.');
    return { quoted, customer: col('Customer'), total: col('Total') };
  };

  it('lists db names and runs an aggregate', async () => {
    const o = await orders();
    const result = await run<{ rows: Record<string, unknown>[]; truncated: boolean }>('sql_query', {
      baseId,
      sql: `select "${o.customer}" as customer, count(*) as n, sum("${o.total}") as total from ${o.quoted} group by 1 order by 1;`,
    });
    expect(result.truncated).toBe(false);
    expect(result.rows).toEqual([
      { customer: 'Acme', n: '125', total: 15750 },
      { customer: 'Globex', n: '125', total: 15625 },
    ]);
  });

  it('caps rows at 200', async () => {
    const o = await orders();
    const result = await run<{ returned: number; truncated: boolean }>('sql_query', {
      baseId,
      sql: `select "${o.total}" from ${o.quoted}`,
    });
    expect(result).toMatchObject({ returned: 200, truncated: true });
  });

  it('keeps the row cap when the query ends in a comment, and stops slow queries', async () => {
    const o = await orders();
    const result = await run<{ returned: number; truncated: boolean }>('sql_query', {
      baseId,
      sql: `select "${o.total}" from ${o.quoted} -- every row`,
    });
    expect(result.truncated).toBe(true);
    expect(result.returned).toBe(200);
    await expect(
      run('sql_query', { baseId, sql: `select pg_sleep(20)::text from ${o.quoted} limit 1` })
    ).rejects.toThrow(/statement timeout|canceling statement/);
  }, 40_000);

  it('refuses writes, other bases and several statements', async () => {
    const o = await orders();
    await expect(run('sql_query', { baseId, sql: `delete from ${o.quoted}` })).rejects.toThrow();
    await expect(run('sql_query', { baseId, sql: `select 1; select 2` })).rejects.toThrow(
      /one statement/
    );
    const other = (
      await run<{ tables: { dbTableName: string }[] }>('sql_tables', { baseId: otherBaseId })
    ).tables[0].dbTableName;
    const quotedOther = other
      .split('.')
      .map((p) => `"${p}"`)
      .join('.');
    await expect(
      run('sql_query', { baseId, sql: `select * from ${quotedOther}` })
    ).rejects.toThrow();
    const count = await run<{ rows: { n: string }[] }>('sql_query', {
      baseId,
      sql: `select count(*) as n from ${o.quoted}`,
    });
    expect(count.rows[0].n).toBe('250');
  });
});

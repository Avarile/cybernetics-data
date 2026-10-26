/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention */
/**
 * data_read (design §8, §9.2): the agent reads every space and base, including ones its admin
 * is not a member of; caps still apply and results reach the model as untrusted data.
 */
import { FieldType } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { getRecords as apiGetRecords } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import type { IAgentProfile } from '../src/features/agent/domain/entities';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { DataReadToolkit } from '../src/features/agent/toolkits/data-read/data-read.toolkit';
import { UNTRUSTED_NOTICE, wrapTool } from '../src/features/agent/toolkits/tool-wrapper';
import type { IToolContext } from '../src/features/agent/toolkits/toolkit.types';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

describe('Agent data_read (e2e)', () => {
  let app: INestApplication;
  let member: AxiosInstance;
  let spaceId: string;
  let baseId: string;
  let tableId: string;
  let firstRecordId: string;
  const adminId = () => globalThis.testConfig.userId;
  const ctx = (): IToolContext => ({
    runId: 'e2e-data',
    actorUserId: adminId(),
    profile: { approvalRequired: [] } as unknown as IAgentProfile,
  });
  const tool = (name: string) => app.get(DataReadToolkit).tools.find((t) => t.name === name)!;
  /** As the agent would: input validated, run as the agent principal. */
  const run = async <T = Record<string, unknown>>(name: string, input: unknown) => {
    const t = tool(name);
    return app
      .get(AgentExecutionContext)
      .run({ runId: 'e2e-data', actorUserId: adminId() }, () =>
        (t.execute as (i: unknown, c: IToolContext) => Promise<unknown>)(
          t.input.parse(input),
          ctx()
        )
      ) as Promise<T>;
  };

  beforeAll(async () => {
    app = (await initApp()).app;
    member = await createNewUserAxios({
      email: 'agent-data-owner@example.com',
      password: '12345678',
    });
    spaceId = (await member.post('/space', { name: 'Private sales' })).data.id;
    baseId = (await member.post('/base', { spaceId, name: 'Deals' })).data.id;
    const table = (
      await member.post(`/base/${baseId}/table/`, {
        name: 'Opportunities',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number },
          {
            name: 'Stage',
            type: FieldType.SingleSelect,
            options: { choices: [{ name: 'won' }, { name: 'lost' }, { name: 'open' }] },
          },
        ],
        records: Array.from({ length: 60 }, (_, i) => ({
          fields: {
            Name: `Deal ${i + 1}`,
            Amount: (i + 1) * 100,
            Stage: i % 3 === 0 ? 'won' : i % 3 === 1 ? 'lost' : 'open',
          },
        })),
      })
    ).data;
    tableId = table.id;
    firstRecordId = (await member.get(`/table/${tableId}/record`, { params: { take: 1 } })).data
      .records[0].id;
  });

  afterAll(async () => {
    await member.delete(`/space/${spaceId}`);
    await app.close();
  });

  it('the admin cannot read the base over HTTP, but the agent can', async () => {
    const error = await getError(() => apiGetRecords(tableId, { take: 1 }));
    expect(error?.status).toBe(403);

    const spaces = await run<{ spaces: { id: string }[] }>('list_spaces', {});
    expect(spaces.spaces.map((s) => s.id)).toContain(spaceId);
    const bases = await run<{ bases: { id: string; name: string }[] }>('list_bases', { spaceId });
    expect(bases.bases).toEqual([{ id: baseId, name: 'Deals', spaceId }]);
    const tables = await run<{ tables: { id: string; name: string }[] }>('list_tables', { baseId });
    expect(tables.tables.map((t) => t.name)).toEqual(['Opportunities']);
  });

  it('describes and queries by table and field name', async () => {
    const described = await run<{ fields: { name: string; choices?: string[] }[] }>(
      'describe_table',
      { baseId, table: 'Opportunities' }
    );
    expect(described.fields.find((f) => f.name === 'Stage')?.choices).toEqual([
      'won',
      'lost',
      'open',
    ]);

    const won = await run<{ records: { fields: Record<string, unknown> }[]; hasMore: boolean }>(
      'query_records',
      {
        baseId,
        table: 'Opportunities',
        filter: {
          conjunction: 'and',
          filterSet: [
            { fieldId: 'Stage', operator: 'is', value: 'won' },
            { fieldId: 'Amount', operator: 'isGreater', value: 5000 },
          ],
        },
        orderBy: [{ field: 'Amount', order: 'desc' }],
        fields: ['Name', 'Amount'],
      }
    );
    expect(won.records.map((r) => r.fields.Amount)).toEqual([5800, 5500, 5200]);
    expect(won.records[0].fields).toEqual({ Name: 'Deal 58', Amount: 5800 });

    const one = await run<{ records: { id: string }[] }>('get_records', {
      baseId,
      table: tableId,
      recordIds: [firstRecordId],
    });
    expect(one.records.map((r) => r.id)).toEqual([firstRecordId]);
  });

  it('caps pages at the ai-data limit', async () => {
    const page = await run<{ returned: number; hasMore: boolean; nextSkip: number }>(
      'query_records',
      { baseId, table: 'Opportunities', take: 100 }
    );
    expect(page.returned).toBe(50);
    expect(page.hasMore).toBe(true);
    expect(page.nextSkip).toBe(50);
    expect(() => tool('query_records').input.parse({ baseId, table: 'x', take: 500 })).toThrow();
  });

  it('aggregates with a filter', async () => {
    const result = await run<{ rowCount: number; values: { func: string; value: unknown }[] }>(
      'aggregate',
      {
        baseId,
        table: 'Opportunities',
        metrics: [
          { field: 'Amount', func: 'sum' },
          { field: 'Amount', func: 'max' },
        ],
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'Stage', operator: 'is', value: 'won' }],
        },
      }
    );
    // won: deals 1, 4, …, 58 → 20 rows, amounts 100, 400, …, 5800
    expect(result.rowCount).toBe(20);
    expect(Number(result.values[0].value)).toBe(59_000);
    expect(Number(result.values[1].value)).toBe(5800);
    await expect(
      run('aggregate', {
        baseId,
        table: 'Opportunities',
        metrics: [{ field: 'Amount', func: 'median' }],
      })
    ).rejects.toThrow(/Unknown function/);
  });

  it('searches names everywhere and rows in a base', async () => {
    const found = await run<{
      bases: { id: string }[];
      tables: { id: string }[];
      records: unknown[];
    }>('search_everywhere', { query: 'opportun', baseId });
    expect(found.tables.map((t) => t.id)).toContain(tableId);
    const rows = await run<{ records: { table: string; records: unknown[] }[] }>(
      'search_everywhere',
      {
        query: 'Deal 42',
        baseId,
      }
    );
    expect(rows.records[0]).toMatchObject({ table: 'Opportunities' });
  });

  it('reaches the model fenced as untrusted data', async () => {
    const wrapped = wrapTool(tool('list_tables'), ctx(), {
      audit: { append: async () => undefined },
      execution: app.get(AgentExecutionContext),
      maxResultChars: 60_000,
    });
    const out = (await (wrapped.execute as (i: unknown, o: object) => Promise<unknown>)(
      { baseId },
      { toolCallId: 't', messages: [] }
    )) as { untrusted_data: unknown; notice: string };
    expect(out.notice).toBe(UNTRUSTED_NOTICE);
    expect(out.untrusted_data).toMatchObject({ tables: [{ name: 'Opportunities' }] });
  });
});

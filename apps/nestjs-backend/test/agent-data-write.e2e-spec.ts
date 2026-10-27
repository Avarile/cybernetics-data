/* eslint-disable sonarjs/no-duplicate-string */
/**
 * data_write and schema (design §8, §9.3): the agent changes records, tables and fields in any
 * base, at most 100 records per call, deletes go to the trash, and the approval rules hold.
 */
import { FieldType } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { AxiosInstance } from 'axios';
import type { IAgentProfile } from '../src/features/agent/domain/entities';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { DEFAULT_AGENT_SETUP } from '../src/features/agent/pack/agent-defaults';
import { DataReadToolkit } from '../src/features/agent/toolkits/data-read/data-read.toolkit';
import {
  DataWriteToolkit,
  SchemaToolkit,
} from '../src/features/agent/toolkits/data-write/data-write.toolkits';
import { wrapTool } from '../src/features/agent/toolkits/tool-wrapper';
import type { IAgentToolDef, IToolContext } from '../src/features/agent/toolkits/toolkit.types';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { initApp } from './utils/init-app';

describe('Agent data_write and schema (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let member: AxiosInstance;
  let spaceId: string;
  let baseId: string;
  const profile = {
    approvalRequired: [...DEFAULT_AGENT_SETUP.approval_required],
  } as unknown as IAgentProfile;
  const ctx = (p = profile): IToolContext => ({
    runId: 'e2e-write',
    actorUserId: globalThis.testConfig.userId,
    profile: p,
  });
  const allTools = (): IAgentToolDef[] => [
    ...app.get(DataReadToolkit).tools,
    ...app.get(DataWriteToolkit).tools,
    ...app.get(SchemaToolkit).tools,
  ];
  const tool = (name: string) => allTools().find((t) => t.name === name)!;
  const run = async <T = Record<string, unknown>>(name: string, input: unknown) => {
    const t = tool(name);
    return (await app
      .get(AgentExecutionContext)
      .run({ runId: 'e2e-write', actorUserId: globalThis.testConfig.userId }, () =>
        (t.execute as (i: unknown, c: IToolContext) => Promise<unknown>)(
          t.input.parse(input),
          ctx()
        )
      )) as T;
  };

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    member = await createNewUserAxios({
      email: 'agent-write-owner@example.com',
      password: '12345678',
    });
    spaceId = (await member.post('/space', { name: 'Ops' })).data.id;
    baseId = (await member.post('/base', { spaceId, name: 'Inventory' })).data.id;
    await member.post(`/base/${baseId}/table/`, {
      name: 'Items',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Qty', type: FieldType.Number },
        { name: 'Status', type: FieldType.SingleSelect, options: { choices: [{ name: 'ok' }] } },
      ],
      records: [],
    });
  });

  afterAll(async () => {
    await member.delete(`/space/${spaceId}`);
    await app.close();
  });

  it('creates, updates and deletes records as the agent', async () => {
    const created = await run<{ created: string[] }>('create_records', {
      baseId,
      table: 'Items',
      records: [
        { Name: 'Bolt', Qty: '12', Status: 'ok' },
        { Name: 'Nut', Qty: 40, Status: 'reorder' },
      ],
    });
    expect(created.created).toHaveLength(2);
    const read = await run<{ records: { id: string; fields: Record<string, unknown> }[] }>(
      'query_records',
      { baseId, table: 'Items', orderBy: [{ field: 'Name', order: 'asc' }] }
    );
    expect(read.records.map((r) => r.fields)).toEqual([
      { Name: 'Bolt', Qty: 12, Status: 'ok' },
      { Name: 'Nut', Qty: 40, Status: 'reorder' },
    ]);
    const tableId = (await prisma.tableMeta.findFirstOrThrow({ where: { baseId, name: 'Items' } }))
      .id;
    const dbTable = (await prisma.tableMeta.findFirstOrThrow({ where: { id: tableId } }))
      .dbTableName;
    const quoted = dbTable
      .split('.')
      .map((part) => `"${part}"`)
      .join('.');
    const meta = await prisma.$queryRawUnsafe<{ createdBy: string }[]>(
      `select "__created_by" as "createdBy" from ${quoted}`
    );
    expect(meta.every((m) => m.createdBy === 'agentRobot')).toBe(true);

    await run('update_records', {
      baseId,
      table: 'Items',
      records: [{ id: created.created[1], fields: { Qty: 0 } }],
    });
    const nut = await run<{ records: { fields: Record<string, unknown> }[] }>('get_records', {
      baseId,
      table: 'Items',
      recordIds: [created.created[1]],
    });
    expect(nut.records[0].fields.Qty).toBe(0);

    const deleted = await run<{ deleted: string[]; note: string }>('delete_records', {
      baseId,
      table: 'Items',
      recordIds: [created.created[0]],
    });
    expect(deleted.note).toMatch(/trash/);
    const left = await run<{ records: unknown[] }>('query_records', { baseId, table: 'Items' });
    expect(left.records).toHaveLength(1);
  });

  it('changes tables and fields, and reads see the change at once', async () => {
    const t = await run<{ id: string; fields: { name: string }[] }>('create_table', {
      baseId,
      name: 'Suppliers',
      fields: [
        { name: 'Company', type: FieldType.SingleLineText },
        { name: 'Rating', type: FieldType.Number },
      ],
    });
    expect(t.fields.map((f) => f.name)).toEqual(['Company', 'Rating']);
    // warm the schema cache, then change the schema
    await run('describe_table', { baseId, table: 'Suppliers' });
    await run('create_field', {
      baseId,
      table: 'Suppliers',
      field: { name: 'Notes', type: FieldType.LongText },
    });
    await run('update_field', {
      baseId,
      table: 'Suppliers',
      field: 'Rating',
      patch: { name: 'Score' },
    });
    await run('update_field', {
      baseId,
      table: 'Suppliers',
      field: 'Score',
      patch: { type: FieldType.SingleLineText },
    });
    const described = await run<{ fields: { name: string; type: string }[] }>('describe_table', {
      baseId,
      table: 'Suppliers',
    });
    expect(described.fields.map((f) => [f.name, f.type])).toEqual([
      ['Company', 'singleLineText'],
      ['Score', 'singleLineText'],
      ['Notes', 'longText'],
    ]);

    await run('delete_field', { baseId, table: 'Suppliers', field: 'Notes' });
    await run('delete_table', { baseId, table: 'Suppliers' });
    const tables = await run<{ tables: { name: string }[] }>('list_tables', { baseId });
    expect(tables.tables.map((x) => x.name)).toEqual(['Items']);
  });

  it("refuses to change the Agent space's tables, but still reads them", async () => {
    const homeSpaceId = (await member.post('/space', { name: 'Agent home' })).data.id;
    const homeBaseId = (await member.post('/base', { spaceId: homeSpaceId, name: 'Agent' })).data
      .id;
    await member.post(`/base/${homeBaseId}/table/`, {
      name: 'agent_credentials',
      fields: [
        { name: 'name', type: FieldType.SingleLineText },
        { name: 'allowed_hosts', type: FieldType.LongText },
      ],
      records: [{ fields: { name: 'github', allowed_hosts: 'api.github.com' } }],
    });
    const original = await prisma.agentInstallation.findUnique({ where: { id: 'agent' } });
    await prisma.agentInstallation.upsert({
      where: { id: 'agent' },
      create: { id: 'agent', spaceId: homeSpaceId, createdBy: globalThis.testConfig.userId },
      update: { spaceId: homeSpaceId },
    });
    try {
      const table = { baseId: homeBaseId, table: 'agent_credentials' };
      const read = await run<{ records: { id: string }[] }>('query_records', table);
      expect(read.records).toHaveLength(1);

      const refused = /Agent base cannot be changed/;
      await expect(
        run('update_records', {
          ...table,
          records: [{ id: read.records[0].id, fields: { allowed_hosts: 'attacker.example' } }],
        })
      ).rejects.toThrow(refused);
      await expect(run('create_records', { ...table, records: [{ name: 'x' }] })).rejects.toThrow(
        refused
      );
      await expect(
        run('create_field', { ...table, field: { name: 'note', type: FieldType.SingleLineText } })
      ).rejects.toThrow(refused);
      await expect(
        run('create_table', {
          baseId: homeBaseId,
          name: 'extra',
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        })
      ).rejects.toThrow(refused);
    } finally {
      if (original) {
        await prisma.agentInstallation.update({
          where: { id: 'agent' },
          data: { spaceId: original.spaceId },
        });
      } else {
        await prisma.agentInstallation.delete({ where: { id: 'agent' } });
      }
      await member.delete(`/space/${homeSpaceId}`);
    }
  });

  it('caps writes at 100 records', () => {
    const rows = Array.from({ length: 101 }, () => ({ Name: 'x' }));
    expect(() =>
      tool('create_records').input.parse({ baseId, table: 'Items', records: rows })
    ).toThrow();
  });

  it('asks for approval: bulk writes, record deletes, schema changes; schema deletes always', () => {
    const deps = {
      audit: { append: async () => undefined },
      execution: app.get(AgentExecutionContext),
      maxResultChars: 60_000,
    };
    const ask = (name: string, input: unknown, p = profile) => {
      const needs = wrapTool(tool(name), ctx(p), deps).needsApproval;
      return typeof needs === 'function' ? needs(input as never, {} as never) : needs;
    };
    const rows = (n: number) => Array.from({ length: n }, () => ({ Name: 'x' }));
    expect(ask('create_records', { records: rows(50) })).toBe(false);
    expect(ask('create_records', { records: rows(51) })).toBe(true);
    expect(
      ask('update_records', { records: rows(51).map(() => ({ id: 'rec1', fields: {} })) })
    ).toBe(true);
    expect(ask('delete_records', {})).toBe(true);
    for (const name of ['create_table', 'create_field', 'update_field'])
      expect(ask(name, {})).toBe(true);
    const nothing = { approvalRequired: [] } as unknown as IAgentProfile;
    expect(ask('delete_records', {}, nothing)).toBe(false);
    expect(ask('delete_field', {}, nothing)).toBe(true);
    expect(ask('delete_table', {}, nothing)).toBe(true);
  });
});

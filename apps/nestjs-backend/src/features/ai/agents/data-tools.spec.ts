/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  dataTools,
  describeTableTool,
  getRecordsTool,
  listTablesTool,
  queryRecordsTool,
} from './data-tools';

const baseId = 'bseCurrent';
const tableId = 'tblAAAA';

const makeAiData = () => ({
  listTables: vi.fn(async () => [{ id: tableId, name: 'Knowledge', description: null }]),
  describeTable: vi.fn(async () => ({ id: tableId, fields: [] })),
  queryRecords: vi.fn(async () => ({ records: [], returned: 0, hasMore: false })),
  getRecords: vi.fn(async () => ({ records: [], missingIds: [] })),
});

const run = (t: any, args: unknown, context: unknown) =>
  t.execute(args, { toolCallId: 'call1', messages: [], experimental_context: context });

describe('data tools', () => {
  it('exposes exactly the four read tools', () => {
    expect(Object.keys(dataTools)).toEqual([
      'listTables',
      'describeTable',
      'queryRecords',
      'getRecords',
    ]);
  });

  it('always use the server-side base id, never one from the model', async () => {
    const aiData = makeAiData();
    const ctx = { aiData, baseId };

    await run(listTablesTool, { baseId: 'bseOther' }, ctx);
    await run(describeTableTool, { tableId }, ctx);
    await run(queryRecordsTool, { tableId }, ctx);
    await run(getRecordsTool, { tableId, recordIds: ['rec1'] }, ctx);

    expect(aiData.listTables).toHaveBeenCalledWith(baseId);
    expect(aiData.describeTable).toHaveBeenCalledWith(baseId, tableId);
    expect(aiData.queryRecords).toHaveBeenCalledWith(baseId, expect.objectContaining({ tableId }));
    expect(aiData.getRecords).toHaveBeenCalledWith(baseId, tableId, ['rec1']);
  });

  it('passes a valid filter and sort through to the service', async () => {
    const aiData = makeAiData();
    const filter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldTitle', operator: 'contains', value: 'Acme' }],
    };
    const orderBy = [{ fieldId: 'fldTitle', order: 'desc' }];

    await run(
      queryRecordsTool,
      { tableId, filter, orderBy, search: 'x', take: 5, skip: 10, projection: ['fldTitle'] },
      { aiData, baseId }
    );

    expect(aiData.queryRecords).toHaveBeenCalledWith(baseId, {
      tableId,
      filter,
      orderBy,
      search: 'x',
      take: 5,
      skip: 10,
      projection: ['fldTitle'],
    });
  });

  it('returns a readable error for a malformed filter instead of querying', async () => {
    const aiData = makeAiData();
    const result = await run(
      queryRecordsTool,
      { tableId, filter: { conjunction: 'maybe', filterSet: 'nope' } },
      { aiData, baseId }
    );
    expect(result.error).toMatch(/^Invalid arguments/);
    expect(aiData.queryRecords).not.toHaveBeenCalled();
  });

  it('turns permission errors into tool results the model can read', async () => {
    const aiData = makeAiData();
    aiData.queryRecords.mockRejectedValueOnce(new ForbiddenException('no access to this table'));
    const result = await run(queryRecordsTool, { tableId }, { aiData, baseId });
    expect(result).toEqual({ error: 'no access to this table' });
  });

  it('hides unexpected errors from the model', async () => {
    const aiData = makeAiData();
    aiData.listTables.mockRejectedValueOnce(new Error('connection to db host 10.0.0.5 refused'));
    const result = await run(listTablesTool, {}, { aiData, baseId });
    expect(result.error).not.toContain('10.0.0.5');
  });

  it('refuses to run without the server-provided context', async () => {
    const result = await run(listTablesTool, {}, { baseId });
    expect(result.error).toBeDefined();
    const noBase = await run(listTablesTool, {}, { aiData: makeAiData() });
    expect(noBase.error).toBeDefined();
  });
});

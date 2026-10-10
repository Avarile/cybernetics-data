/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AiDataService } from './ai-data.service';

const baseA = 'bseAAAA';
const baseB = 'bseBBBB';
const tableA = 'tblAAAA';
const tableB = 'tblBBBB';
const recordRead = 'record|read';
const tableRead = 'table|read';
const tableNotFound = 'Table not found';

const config = { maxRecordsPerCall: 3, maxCellChars: 20, maxResponseChars: 10_000 };

const makeCls = (accessTokenId?: string) => {
  const store: Record<string, unknown> = accessTokenId ? { accessTokenId } : {};
  return {
    get: vi.fn((key?: string) => (key === undefined ? store : store[key])),
    set: vi.fn((key: string, value: unknown) => {
      store[key] = value;
    }),
    store,
  };
};

const build = (
  overrides: {
    cls?: ReturnType<typeof makeCls>;
    permission?: Record<string, any>;
    record?: Record<string, any>;
    table?: Record<string, any>;
    field?: Record<string, any>;
    config?: Partial<typeof config>;
  } = {}
) => {
  const cls = overrides.cls ?? makeCls('tokenA');
  const permission = {
    validPermissions: vi.fn(async () => [recordRead, tableRead, 'field|read']),
    getUpperIdByTableId: vi.fn(async (tableId: string) => ({
      spaceId: 'spc1',
      baseId: tableId === tableB ? baseB : baseA,
    })),
    ...overrides.permission,
  };
  const table = {
    getTables: vi.fn(async () => [
      { id: tableA, name: 'Knowledge', description: null },
      { id: 'tblCCCC', name: 'Goals', description: 'All goals' },
    ]),
    getTable: vi.fn(async () => ({ id: tableA, name: 'Knowledge', description: 'KB' })),
    ...overrides.table,
  };
  const field = {
    getFields: vi.fn(async () => [
      { id: 'fld1', name: 'Title', type: 'singleLineText', isPrimary: true },
      {
        id: 'fld2',
        name: 'Type',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'Note', id: 'x' },
            { name: 'Doc', id: 'y' },
          ],
        },
      },
      {
        id: 'fld3',
        name: 'Parent',
        type: 'link',
        options: { foreignTableId: 'tblCCCC', relationship: 'manyOne' },
      },
      {
        id: 'fld4',
        name: 'Lookup',
        type: 'singleLineText',
        isComputed: true,
        lookupOptions: { foreignTableId: 'tblDDDD' },
        options: { showAs: {} },
      },
    ]),
    ...overrides.field,
  };
  const record = {
    getRecords: vi.fn(async () => ({ records: [{ id: 'rec1', fields: { fld1: 'Hello' } }] })),
    getRecordsById: vi.fn(async () => ({ records: [{ id: 'rec1', fields: { fld1: 'Hello' } }] })),
    ...overrides.record,
  };
  const service = new AiDataService(
    { ...config, ...overrides.config } as any,
    cls as any,
    permission as any,
    table as any,
    field as any,
    record as any
  );
  return { service, cls, permission, table, field, record };
};

describe('AiDataService.listTables', () => {
  it('authorizes table|read on the base, publishes permissions to CLS, and maps the result', async () => {
    const { service, permission, cls } = build();
    const tables = await service.listTables(baseA);

    expect(permission.validPermissions).toHaveBeenCalledWith(baseA, [tableRead], 'tokenA');
    expect(cls.set).toHaveBeenCalledWith('permissions', expect.arrayContaining([tableRead]));
    expect(tables).toEqual([
      { id: tableA, name: 'Knowledge', description: null },
      { id: 'tblCCCC', name: 'Goals', description: 'All goals' },
    ]);
  });

  it('rejects a wrong-prefix base id before touching anything', async () => {
    const { service, permission, table } = build();
    await expect(service.listTables('tblWrong')).rejects.toThrow(/base id/);
    expect(permission.validPermissions).not.toHaveBeenCalled();
    expect(table.getTables).not.toHaveBeenCalled();
  });

  it('does not read tables when permission is denied', async () => {
    const { service, table } = build({
      permission: {
        validPermissions: vi.fn(async () => {
          throw new ForbiddenException('no permission');
        }),
      },
    });
    await expect(service.listTables(baseA)).rejects.toThrow('no permission');
    expect(table.getTables).not.toHaveBeenCalled();
  });
});

describe('AiDataService.describeTable', () => {
  it('returns a compact field list with link targets and select choices', async () => {
    const { service, permission } = build();
    const result = await service.describeTable(baseA, tableA);

    expect(permission.validPermissions).toHaveBeenCalledWith(
      tableA,
      [tableRead, 'field|read'],
      'tokenA'
    );
    expect(result.baseId).toBe(baseA);
    expect(result.fields).toEqual([
      { id: 'fld1', name: 'Title', type: 'singleLineText', isPrimary: true, isComputed: false },
      {
        id: 'fld2',
        name: 'Type',
        type: 'singleSelect',
        isPrimary: false,
        isComputed: false,
        choices: ['Note', 'Doc'],
      },
      {
        id: 'fld3',
        name: 'Parent',
        type: 'link',
        isPrimary: false,
        isComputed: false,
        linkedTableId: 'tblCCCC',
      },
      {
        id: 'fld4',
        name: 'Lookup',
        type: 'singleLineText',
        isPrimary: false,
        isComputed: true,
        linkedTableId: 'tblDDDD',
      },
    ]);
  });

  it('treats a table from another base exactly like a missing table', async () => {
    const { service, field, permission } = build();
    await expect(service.describeTable(baseA, tableB)).rejects.toThrow(tableNotFound);
    expect(field.getFields).not.toHaveBeenCalled();
    expect(permission.validPermissions).not.toHaveBeenCalled();
  });

  it('reports a table that does not exist with the same message', async () => {
    const { service } = build({
      permission: {
        getUpperIdByTableId: vi.fn(async () => {
          throw new NotFoundException('gone');
        }),
      },
    });
    await expect(service.describeTable(baseA, 'tblMissing')).rejects.toThrow(tableNotFound);
  });
});

describe('AiDataService.queryRecords', () => {
  it('reads by field id as the current user and reports no more rows', async () => {
    const { service, record, permission } = build();
    const result = await service.queryRecords(baseA, { tableId: tableA, take: 2, search: 'foo' });

    expect(permission.validPermissions).toHaveBeenCalledWith(tableA, [recordRead], 'tokenA');
    expect(record.getRecords).toHaveBeenCalledWith(
      tableA,
      expect.objectContaining({
        take: 3,
        skip: 0,
        search: ['foo'],
        fieldKeyType: 'id',
      })
    );
    expect(result).toEqual({
      records: [{ id: 'rec1', fields: { fld1: 'Hello' } }],
      returned: 1,
      hasMore: false,
      nextSkip: null,
      truncated: false,
    });
  });

  it('caps take at maxRecordsPerCall and pages with hasMore / nextSkip', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `rec${i}`, fields: { fld1: 'v' } }));
    const { service, record } = build({
      record: { getRecords: vi.fn(async () => ({ records: rows })) },
    });

    const result = await service.queryRecords(baseA, { tableId: tableA, take: 500, skip: 10 });

    expect((record.getRecords.mock.calls[0] as any[])[1].take).toBe(config.maxRecordsPerCall + 1);
    expect(result.returned).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextSkip).toBe(13);
  });

  it('cuts oversized cells and flags the result as truncated', async () => {
    const { service } = build({
      record: {
        getRecords: vi.fn(async () => ({
          records: [{ id: 'rec1', fields: { fld1: 'x'.repeat(100) } }],
        })),
      },
    });
    const result = await service.queryRecords(baseA, { tableId: tableA });
    expect(result.truncated).toBe(true);
    expect(result.records[0].fields.fld1 as string).toContain('truncated');
  });

  it('keeps paging correct when records are dropped to fit the size budget', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `rec${i}`, fields: { fld1: 'abc' } }));
    const { service } = build({
      config: { maxResponseChars: 60 },
      record: { getRecords: vi.fn(async () => ({ records: rows })) },
    });
    const result = await service.queryRecords(baseA, { tableId: tableA, take: 3, skip: 5 });
    expect(result.returned).toBeLessThan(3);
    expect(result.hasMore).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.nextSkip).toBe(5 + result.returned);
  });

  it("does not query another base's table", async () => {
    const { service, record } = build();
    await expect(service.queryRecords(baseA, { tableId: tableB })).rejects.toThrow(tableNotFound);
    expect(record.getRecords).not.toHaveBeenCalled();
  });

  it('does not query when record|read is denied', async () => {
    const { service, record } = build({
      permission: {
        validPermissions: vi.fn(async () => {
          throw new ForbiddenException('denied');
        }),
      },
    });
    await expect(service.queryRecords(baseA, { tableId: tableA })).rejects.toThrow('denied');
    expect(record.getRecords).not.toHaveBeenCalled();
  });
});

describe('AiDataService.getRecords', () => {
  it('fetches the ids in one batch, de-duplicated, and reports missing ones', async () => {
    const { service, record } = build();
    const result = await service.getRecords(baseA, tableA, ['rec1', 'rec1', 'rec2']);

    expect(record.getRecordsById).toHaveBeenCalledTimes(1);
    expect(record.getRecordsById).toHaveBeenCalledWith(tableA, ['rec1', 'rec2']);
    expect(result.returned).toBe(1);
    expect(result.missingIds).toEqual(['rec2']);
  });

  it('treats "none found" as an empty result instead of an error', async () => {
    const { service } = build({
      record: {
        getRecordsById: vi.fn(async () => {
          throw new NotFoundException('Can not get record');
        }),
      },
    });
    const result = await service.getRecords(baseA, tableA, ['rec9']);
    expect(result.records).toEqual([]);
    expect(result.missingIds).toEqual(['rec9']);
  });

  it('rethrows non-404 errors', async () => {
    const { service } = build({
      record: {
        getRecordsById: vi.fn(async () => {
          throw new ForbiddenException('nope');
        }),
      },
    });
    await expect(service.getRecords(baseA, tableA, ['rec1'])).rejects.toThrow('nope');
  });

  it('rejects empty and oversized id lists', async () => {
    const { service, record } = build();
    await expect(service.getRecords(baseA, tableA, [])).rejects.toThrow(/must not be empty/);
    await expect(service.getRecords(baseA, tableA, ['r1', 'r2', 'r3', 'r4'])).rejects.toThrow(
      /Too many record ids/
    );
    expect(record.getRecordsById).not.toHaveBeenCalled();
  });
});

describe('AiDataService serialization', () => {
  it('runs calls from one request one after another, never interleaved', async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const { service } = build({
      permission: {
        validPermissions: vi.fn(async (resourceId: string) => {
          events.push(`start:${resourceId}`);
          if (resourceId === baseA) await gate;
          events.push(`end:${resourceId}`);
          return [tableRead];
        }),
      },
    });

    const first = service.listTables(baseA);
    const second = service.listTables(baseB);
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([`start:${baseA}`]);

    release();
    await Promise.all([first, second]);
    expect(events).toEqual([`start:${baseA}`, `end:${baseA}`, `start:${baseB}`, `end:${baseB}`]);
  });

  it('keeps going after a failed call', async () => {
    const { service } = build({
      permission: {
        validPermissions: vi
          .fn()
          .mockRejectedValueOnce(new ForbiddenException('first fails'))
          .mockResolvedValue([tableRead]),
      },
    });
    const first = service.listTables(baseA);
    const second = service.listTables(baseA);
    await expect(first).rejects.toThrow('first fails');
    await expect(second).resolves.toHaveLength(2);
  });
});

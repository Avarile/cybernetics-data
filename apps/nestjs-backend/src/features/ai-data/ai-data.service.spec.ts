/* eslint-disable @typescript-eslint/no-explicit-any, sonarjs/no-duplicate-string */
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { SortFunc } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { AiDataService } from './ai-data.service';

const baseA = 'bseAAAA';
const baseB = 'bseBBBB';
const tableA = 'tblAAAA'; // "Knowledge": follows the template convention
const tablePlain = 'tblCCCC'; // "Goals": no deleted_at / context
const tableB = 'tblBBBB'; // only in base B
const recordRead = 'record|read';
const tableRead = 'table|read';
const fieldRead = 'field|read';
const tableNotFound = 'Table not found';

const config = { maxRecordsPerCall: 3, maxCellChars: 20, maxResponseChars: 10_000 };

const knowledgeFields = [
  { id: 'fldTitle', name: 'title', type: 'singleLineText', isPrimary: true },
  { id: 'fldCtx', name: 'context', type: 'longText' },
  {
    id: 'fldType',
    name: 'Type',
    type: 'singleSelect',
    options: { choices: [{ name: 'Note' }, { name: 'Doc' }] },
  },
  { id: 'fldParent', name: 'Parent', type: 'link', options: { foreignTableId: tablePlain } },
  {
    id: 'fldLookup',
    name: 'Lookup',
    type: 'singleLineText',
    isComputed: true,
    lookupOptions: { foreignTableId: 'tblDDDD' },
  },
  { id: 'fldDel', name: 'deleted_at', type: 'date' },
  { id: 'fldActive', name: 'is_active', type: 'checkbox' },
];
const plainFields = [{ id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true }];

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
    permission?: Record<string, any>;
    record?: Record<string, any>;
    table?: Record<string, any>;
    field?: Record<string, any>;
    config?: Partial<typeof config>;
    audit?: Record<string, any>;
  } = {}
) => {
  const cls = makeCls('tokenA');
  const permission = {
    validPermissions: vi.fn(async () => [recordRead, tableRead, fieldRead]),
    ...overrides.permission,
  };
  const table = {
    getTables: vi.fn(async (baseId: string) =>
      baseId === baseA
        ? [
            { id: tableA, name: 'Knowledge', description: null },
            { id: tablePlain, name: 'Goals', description: 'All goals' },
            { id: 'tblDup1', name: 'Dup', description: null },
            { id: 'tblDup2', name: 'DUP', description: null },
          ]
        : [{ id: tableB, name: 'Secret', description: null }]
    ),
    ...overrides.table,
  };
  const field = {
    getFields: vi.fn(async (tableId: string) =>
      tableId === tableA ? knowledgeFields : plainFields
    ),
    ...overrides.field,
  };
  const record = {
    getRecords: vi.fn(async () => ({ records: [{ id: 'rec1', fields: { fldTitle: 'Hello' } }] })),
    getRecordsById: vi.fn(async () => ({
      records: [{ id: 'rec1', fields: { fldTitle: 'Hello' } }],
    })),
    ...overrides.record,
  };
  const audit = {
    checkRate: vi.fn(async () => undefined),
    record: vi.fn(),
    ...overrides.audit,
  };
  const service = new AiDataService(
    { ...config, ...overrides.config } as any,
    cls as any,
    permission as any,
    table as any,
    field as any,
    record as any,
    audit as any
  );
  return { service, cls, permission, table, field, record, audit };
};

const queryArgs = (record: { getRecords: { mock: { calls: unknown[][] } } }) =>
  record.getRecords.mock.calls[0][1] as any;

describe('AiDataService.listTables', () => {
  it('authorizes table|read on the base, publishes permissions to CLS, and maps the result', async () => {
    const { service, permission, cls } = build();
    const tables = await service.listTables(baseA);

    expect(permission.validPermissions).toHaveBeenCalledWith(baseA, [tableRead], 'tokenA');
    expect(cls.set).toHaveBeenCalledWith('permissions', expect.arrayContaining([tableRead]));
    expect(tables.map((t) => t.name)).toEqual(['Knowledge', 'Goals', 'Dup', 'DUP']);
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

describe('AiDataService table resolution', () => {
  it('finds a table by id, by exact name, and by unambiguous case-insensitive name', async () => {
    const { service } = build();
    expect((await service.describeTable(baseA, tableA)).id).toBe(tableA);
    expect((await service.describeTable(baseA, 'Knowledge')).id).toBe(tableA);
    expect((await service.describeTable(baseA, 'knowledge')).id).toBe(tableA);
    expect((await service.describeTable(baseA, ' Goals ')).id).toBe(tablePlain);
  });

  it('prefers the exact name and refuses an ambiguous loose match', async () => {
    const { service } = build();
    expect((await service.describeTable(baseA, 'DUP')).id).toBe('tblDup2');
    await expect(service.describeTable(baseA, 'dup')).rejects.toThrow(tableNotFound);
  });

  it('treats a table from another base exactly like a missing one, by id or by name', async () => {
    const { service, field } = build();
    await expect(service.describeTable(baseA, tableB)).rejects.toThrow(tableNotFound);
    await expect(service.describeTable(baseA, 'Secret')).rejects.toThrow(tableNotFound);
    await expect(service.queryRecords(baseA, { tableId: tableB })).rejects.toThrow(tableNotFound);
    expect(field.getFields).not.toHaveBeenCalled();
  });

  it('checks the base before looking up names, so names of an unreadable base never leak', async () => {
    const { service, table } = build({
      permission: {
        validPermissions: vi.fn(async (resourceId: string) => {
          if (resourceId === baseB) throw new ForbiddenException('no base access');
          return [recordRead, tableRead, fieldRead];
        }),
      },
    });
    await expect(service.describeTable(baseB, 'Secret')).rejects.toThrow('no base access');
    await expect(service.describeTable(baseB, 'Nope')).rejects.toThrow('no base access');
    expect(table.getTables).not.toHaveBeenCalled();
  });

  it('caches table and field lists between calls', async () => {
    const { service, table, field } = build();
    await service.describeTable(baseA, 'Knowledge');
    await service.queryRecords(baseA, { tableId: 'Knowledge' });
    await service.describeTable(baseA, tableA);
    expect(table.getTables).toHaveBeenCalledTimes(1);
    expect(field.getFields).toHaveBeenCalledTimes(1);
  });
});

describe('AiDataService.describeTable', () => {
  it('returns compact fields and the detected profile', async () => {
    const { service, permission } = build();
    const result = await service.describeTable(baseA, tableA);

    expect(permission.validPermissions).toHaveBeenCalledWith(
      tableA,
      [tableRead, fieldRead],
      'tokenA'
    );
    expect(result).toMatchObject({ id: tableA, name: 'Knowledge', baseId: baseA });
    expect(result.profile).toEqual({
      titleFieldId: 'fldTitle',
      contextFieldId: 'fldCtx',
      softDeleteFieldId: 'fldDel',
    });
    expect(result.fields.find((f) => f.id === 'fldType')?.choices).toEqual(['Note', 'Doc']);
    expect(result.fields.find((f) => f.id === 'fldParent')?.linkedTableId).toBe(tablePlain);
    expect(result.fields.find((f) => f.id === 'fldLookup')).toMatchObject({
      isComputed: true,
      linkedTableId: 'tblDDDD',
    });
  });

  it('reports no soft-delete field for a table outside the convention', async () => {
    const { service } = build();
    expect((await service.describeTable(baseA, 'Goals')).profile).toEqual({
      titleFieldId: 'fldName',
    });
  });
});

describe('AiDataService.queryRecords', () => {
  it('reads as the current user and leaves soft-deleted rows out by default', async () => {
    const { service, record, permission } = build();
    const result = await service.queryRecords(baseA, { tableId: 'Knowledge', search: 'foo' });

    expect(permission.validPermissions).toHaveBeenCalledWith(
      tableA,
      [recordRead, fieldRead],
      'tokenA'
    );
    const args = queryArgs(record);
    expect(args).toMatchObject({ take: 4, skip: 0, search: ['foo'], fieldKeyType: 'id' });
    expect(args.filter).toEqual({
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldDel', operator: 'isEmpty', value: null }],
    });
    expect(result.softDeletedExcluded).toBe(true);
  });

  it('keeps the caller filter and ANDs the soft-delete condition onto it', async () => {
    const { service, record } = build();
    const filter = {
      conjunction: 'or',
      filterSet: [{ fieldId: 'title', operator: 'contains', value: 'x' }],
    } as any;
    await service.queryRecords(baseA, { tableId: tableA, filter });
    expect(queryArgs(record).filter).toEqual({
      conjunction: 'and',
      filterSet: [
        {
          conjunction: 'or',
          filterSet: [{ fieldId: 'fldTitle', operator: 'contains', value: 'x' }],
        },
        { fieldId: 'fldDel', operator: 'isEmpty', value: null },
      ],
    });
  });

  it('includes soft-deleted rows on request, and never filters a table outside the convention', async () => {
    const opted = build();
    const r1 = await opted.service.queryRecords(baseA, { tableId: tableA, includeDeleted: true });
    expect(queryArgs(opted.record).filter).toBeUndefined();
    expect(r1.softDeletedExcluded).toBe(false);

    const plain = build();
    const r2 = await plain.service.queryRecords(baseA, { tableId: 'Goals' });
    expect(queryArgs(plain.record).filter).toBeUndefined();
    expect(r2.softDeletedExcluded).toBe(false);
  });

  it('translates field names in sort and projection, and can key cells by name', async () => {
    const { service, record } = build();
    const result = await service.queryRecords(baseA, {
      tableId: tableA,
      orderBy: [{ fieldId: 'title', order: SortFunc.Desc }],
      projection: ['title', 'fldCtx'],
      fieldKeyType: 'name',
    });
    expect(queryArgs(record)).toMatchObject({
      orderBy: [{ fieldId: 'fldTitle', order: 'desc' }],
      projection: ['fldTitle', 'fldCtx'],
      fieldKeyType: 'id',
    });
    expect(result.records).toEqual([{ id: 'rec1', fields: { title: 'Hello' } }]);
  });

  it('names the unknown field and lists the real ones', async () => {
    const { service, record } = build();
    await expect(
      service.queryRecords(baseA, { tableId: tableA, projection: ['nope'] })
    ).rejects.toThrow(/Unknown field "nope" in table "Knowledge". Fields: title, context/);
    expect(record.getRecords).not.toHaveBeenCalled();
  });

  it('caps take at maxRecordsPerCall and pages with hasMore / nextSkip', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: `rec${i}`,
      fields: { fldTitle: 'v' },
    }));
    const { service, record } = build({
      record: { getRecords: vi.fn(async () => ({ records: rows })) },
    });
    const result = await service.queryRecords(baseA, { tableId: tableA, take: 500, skip: 10 });
    expect(queryArgs(record).take).toBe(config.maxRecordsPerCall + 1);
    expect(result).toMatchObject({ returned: 3, hasMore: true, nextSkip: 13 });
  });

  it('cuts oversized cells, flags truncated, and keeps paging right when rows are held back', async () => {
    const big = build({
      record: {
        getRecords: vi.fn(async () => ({
          records: [{ id: 'rec1', fields: { fldTitle: 'x'.repeat(100) } }],
        })),
      },
    });
    const r1 = await big.service.queryRecords(baseA, { tableId: tableA });
    expect(r1.truncated).toBe(true);
    expect(r1.records[0].fields.fldTitle as string).toContain('truncated');

    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `rec${i}`,
      fields: { fldTitle: 'abc' },
    }));
    const tight = build({
      config: { maxResponseChars: 60 },
      record: { getRecords: vi.fn(async () => ({ records: rows })) },
    });
    const r2 = await tight.service.queryRecords(baseA, { tableId: tableA, take: 3, skip: 5 });
    expect(r2.returned).toBeLessThan(3);
    expect(r2.hasMore).toBe(true);
    expect(r2.nextSkip).toBe(5 + r2.returned);
  });

  it('does not query when record|read is denied', async () => {
    const { service, record } = build({
      permission: {
        validPermissions: vi.fn(async (resourceId: string) => {
          if (resourceId === tableA) throw new ForbiddenException('denied');
          return [tableRead];
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
    const result = await service.getRecords(baseA, 'Knowledge', ['rec1', 'rec1', 'rec2']);
    expect(record.getRecordsById).toHaveBeenCalledTimes(1);
    expect(record.getRecordsById).toHaveBeenCalledWith(tableA, ['rec1', 'rec2']);
    expect(result.returned).toBe(1);
    expect(result.missingIds).toEqual(['rec2']);
  });

  it('can key cells by field name', async () => {
    const { service } = build();
    const result = await service.getRecords(baseA, tableA, ['rec1'], { fieldKeyType: 'name' });
    expect(result.records).toEqual([{ id: 'rec1', fields: { title: 'Hello' } }]);
  });

  it('treats "none found" as an empty result and rethrows other errors', async () => {
    const empty = build({
      record: {
        getRecordsById: vi.fn(async () => {
          throw new NotFoundException('Can not get record');
        }),
      },
    });
    const result = await empty.service.getRecords(baseA, tableA, ['rec9']);
    expect(result).toMatchObject({ records: [], missingIds: ['rec9'] });

    const denied = build({
      record: {
        getRecordsById: vi.fn(async () => {
          throw new ForbiddenException('nope');
        }),
      },
    });
    await expect(denied.service.getRecords(baseA, tableA, ['rec1'])).rejects.toThrow('nope');
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
    await expect(second).resolves.toHaveLength(4);
  });
});

describe('AiDataService audit and rate limit', () => {
  it('audits each call with user, base, table, transport and row count', async () => {
    const { service, cls, audit } = build();
    cls.store.user = { id: 'usr1' };
    cls.store.origin = { byApi: true };
    await service.queryRecords(baseA, { tableId: 'Knowledge' });

    expect(audit.checkRate).toHaveBeenCalledWith('usr1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'queryRecords',
        userId: 'usr1',
        baseId: baseA,
        table: 'Knowledge',
        via: 'internal-api',
        ok: true,
        rows: 1,
      })
    );
  });

  it('audits refusals with their status', async () => {
    const { service, audit } = build();
    await expect(service.describeTable(baseA, tableB)).rejects.toThrow(tableNotFound);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'describeTable', ok: false, status: 404, via: 'session' })
    );
  });

  it('stops a rate-limited call before any permission check or data access', async () => {
    const { service, permission, record, table, audit } = build({
      audit: {
        checkRate: vi.fn(async () => {
          throw new HttpException('slow down', 429);
        }),
      },
    });
    await expect(service.queryRecords(baseA, { tableId: tableA })).rejects.toThrow('slow down');
    expect(permission.validPermissions).not.toHaveBeenCalled();
    expect(table.getTables).not.toHaveBeenCalled();
    expect(record.getRecords).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ ok: false, status: 429 }));
  });
});

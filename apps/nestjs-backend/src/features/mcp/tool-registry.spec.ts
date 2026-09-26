/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import type { IMcpConfig } from '../../configs/mcp.config';
import { McpToolRegistry } from './tool-registry';

const baseTestConfig: IMcpConfig = {
  enabled: true,
  readonly: false,
  maxRecordsPerCall: 500,
  maxDeletePerCall: 200,
};

/** Tools excluded by design decision D5 — irreversible, so never exposed. */
const excludedTools = [
  'delete_field',
  'delete_table',
  'update_field',
  'convert_field',
  'delete_base',
];

const makeCls = (accessTokenId?: string) => {
  const store = new Map<string, unknown>();
  if (accessTokenId) store.set('accessTokenId', accessTokenId);
  return {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: unknown) => store.set(key, value)),
    _store: store,
  };
};

const tableIdForTests = 'tbl123';
const recordRead = 'record|read';

const makePermissionService = () => ({
  validPermissions: vi.fn(async () => [recordRead, 'record|delete'] as any),
  getAccessToken: vi.fn(async () => ({ scopes: ['space|read', 'base|read'] }) as any),
  getUpperIdByTableId: vi.fn(async () => ({ spaceId: 'spc1', baseId: 'bse1' })),
});

const build = (
  overrides: {
    config?: Partial<IMcpConfig>;
    cls?: ReturnType<typeof makeCls>;
    permissionService?: ReturnType<typeof makePermissionService>;
    services?: Record<string, unknown>;
  } = {}
) => {
  const cls = overrides.cls ?? makeCls('tokenA');
  const permissionService = overrides.permissionService ?? makePermissionService();
  const services = {
    spaceService: {
      getSpaceList: vi.fn(async () => []),
      getBaseListBySpaceId: vi.fn(async () => []),
    },
    baseService: { getAllBaseList: vi.fn(async () => []) },
    tableService: {
      getTables: vi.fn(async () => []),
      getTable: vi.fn(async () => ({ id: 'tbl1', name: 'T' })),
      updateName: vi.fn(async () => undefined),
      updateDescription: vi.fn(async () => undefined),
      updateIcon: vi.fn(async () => undefined),
      createTable: vi.fn(async () => ({ id: 'tbl1', name: 'T' })),
    },
    fieldService: { getFields: vi.fn(async () => []), createField: vi.fn(async () => ({})) },
    recordService: {
      getRecords: vi.fn(async () => ({ records: [] })),
      getRecord: vi.fn(async () => ({ id: 'rec1', fields: {} })),
    },
    recordWriteService: {
      multipleCreateRecords: vi.fn(async () => ({ records: [] })),
      updateRecord: vi.fn(async () => ({ id: 'rec1', fields: {} })),
      deleteRecords: vi.fn(async () => undefined),
    },
    viewService: { getViews: vi.fn(async () => []) },
    viewWriteService: {
      createView: vi.fn(async () => ({})),
      deleteView: vi.fn(async () => undefined),
    },
    graphService: { query: vi.fn(async () => ({ etag: 'e', notModified: false, vo: undefined })) },
    graphNodeService: { expand: vi.fn(async () => ({ nodes: [], links: [], truncated: false })) },
    ...overrides.services,
  };

  const registry = new McpToolRegistry(
    { ...baseTestConfig, ...overrides.config },
    cls as any,
    permissionService as any,
    services.spaceService as any,
    services.baseService as any,
    services.tableService as any,
    services.fieldService as any,
    services.recordService as any,
    services.recordWriteService as any,
    services.viewService as any,
    services.viewWriteService as any,
    services.graphService as any,
    services.graphNodeService as any
  );
  return { registry, cls, permissionService, services };
};

describe('McpToolRegistry', () => {
  describe('catalogue invariants', () => {
    it('registers every tool with a non-empty requiredActions', () => {
      const { registry } = build();
      const tools = registry.list();
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool.requiredActions.length, `${tool.name} declares no actions`).toBeGreaterThan(0);
      }
    });

    it('registers no duplicate tool names', () => {
      const { registry } = build();
      const names = registry.list().map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it.each(excludedTools)('never exposes the excluded tool %s', (name) => {
      const { registry } = build();
      expect(registry.get(name)).toBeUndefined();
    });

    it('exposes the expected catalogue', () => {
      const { registry } = build();
      expect(
        registry
          .list()
          .map((t) => t.name)
          .sort()
      ).toEqual(
        [
          'create_field',
          'create_records',
          'create_table',
          'create_view',
          'delete_records',
          'delete_view',
          'get_graph',
          'get_record',
          'get_record_neighbors',
          'get_table_schema',
          'list_bases',
          'list_spaces',
          'list_tables',
          'list_views',
          'query_records',
          'update_record',
          'update_table',
        ].sort()
      );
    });

    it('gives every destructive tool destructiveHint and every read tool readOnlyHint', () => {
      const { registry } = build();
      const byName = Object.fromEntries(registry.list().map((t) => [t.name, t]));
      expect(byName.delete_records.annotations.destructiveHint).toBe(true);
      expect(byName.delete_view.annotations.destructiveHint).toBe(true);
      expect(byName.query_records.annotations.readOnlyHint).toBe(true);
      expect(byName.create_records.annotations.readOnlyHint).toBe(false);
    });
  });

  describe('read-only mode', () => {
    it('drops every write tool', () => {
      const { registry } = build({ config: { readonly: true } });
      const tools = registry.list();
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool.annotations.readOnlyHint, `${tool.name} survived read-only mode`).toBe(true);
      }
      expect(registry.get('delete_records')).toBeUndefined();
      expect(registry.get('create_records')).toBeUndefined();
      expect(registry.get('query_records')).toBeDefined();
    });
  });

  describe('authorization pipeline', () => {
    it('validates permissions against the resolved resource before executing', async () => {
      const { registry, permissionService, services } = build();
      await registry.invoke('query_records', { tableId: tableIdForTests });

      expect(permissionService.validPermissions).toHaveBeenCalledWith(
        tableIdForTests,
        [recordRead],
        'tokenA'
      );
      expect(services.recordService.getRecords).toHaveBeenCalled();
    });

    it('publishes the resolved permissions to cls', async () => {
      // Not bookkeeping: table-open-api.service.ts:833 and friends read this
      // back. Omitting it yields wrong output with a 200 status.
      const { registry, cls } = build();
      await registry.invoke('query_records', { tableId: tableIdForTests });

      expect(cls.set).toHaveBeenCalledWith('permissions', [recordRead, 'record|delete']);
    });

    it('does not execute when validPermissions throws', async () => {
      const permissionService = makePermissionService();
      permissionService.validPermissions = vi.fn(async () => {
        throw new Error('not allowed to operate record|read on tbl123');
      });
      const { registry, services } = build({ permissionService });

      await expect(registry.invoke('query_records', { tableId: tableIdForTests })).rejects.toThrow(
        'not allowed'
      );
      expect(services.recordService.getRecords).not.toHaveBeenCalled();
    });

    it('refuses to persist a view with an unknown type', async () => {
      // Regression: before create_view parsed viewRoSchema, a live run stored
      // a view of type "notAViewType", and every page that loaded that table's
      // views then crashed in the SDK's createViewInstance.
      const { registry, services } = build();
      await expect(
        registry.invoke('create_view', {
          tableId: tableIdForTests,
          name: 'nope',
          type: 'notAViewType',
        })
      ).rejects.toThrow();
      expect(services.viewWriteService.createView).not.toHaveBeenCalled();
    });

    it('rejects an unknown tool', async () => {
      const { registry } = build();
      await expect(registry.invoke('drop_everything', {})).rejects.toThrow('Unknown tool');
    });

    it('rejects arguments that fail the tool schema', async () => {
      const { registry, services } = build();
      await expect(registry.invoke('query_records', {})).rejects.toThrow();
      expect(services.recordService.getRecords).not.toHaveBeenCalled();
    });

    it('never lists bases outside the token restriction', async () => {
      // BaseService.getAllBaseList filters by USER but not by TOKEN, so
      // list_bases must apply the restriction itself or a narrow token
      // enumerates every base its owner can see.
      const baseService = {
        getAllBaseList: vi.fn(async () => [
          { id: 'bseAllowed', name: 'Allowed', spaceId: 'spcAllowed' },
          { id: 'bseInSpace', name: 'In allowed space', spaceId: 'spcAllowed' },
          { id: 'bseOther', name: 'Someone elses', spaceId: 'spcOther' },
        ]),
      };
      const permissionService = makePermissionService();
      permissionService.getAccessToken = vi.fn(async () => ({
        scopes: ['base|read'],
        baseIds: ['bseAllowed'],
        spaceIds: ['spcAllowed'],
        hasFullAccess: false,
      })) as any;

      const { registry } = build({ services: { baseService }, permissionService });
      const bases = (await registry.invoke('list_bases', {})) as { id: string }[];

      expect(bases.map((b) => b.id)).toEqual(['bseAllowed', 'bseInSpace']);
      expect(bases.map((b) => b.id)).not.toContain('bseOther');
    });

    it('lists every base for a token with full access', async () => {
      const baseService = {
        getAllBaseList: vi.fn(async () => [
          { id: 'bseA', name: 'A', spaceId: 'spc1' },
          { id: 'bseB', name: 'B', spaceId: 'spc2' },
        ]),
      };
      const permissionService = makePermissionService();
      permissionService.getAccessToken = vi.fn(async () => ({
        scopes: ['base|read'],
        hasFullAccess: true,
      })) as any;

      const { registry } = build({ services: { baseService }, permissionService });
      const bases = (await registry.invoke('list_bases', {})) as { id: string }[];

      expect(bases.map((b) => b.id)).toEqual(['bseA', 'bseB']);
    });

    it('checks the space resource when list_bases is given a spaceId', async () => {
      const { registry, permissionService } = build();
      await registry.invoke('list_bases', { spaceId: 'spc999' });

      expect(permissionService.validPermissions).toHaveBeenCalledWith(
        'spc999',
        ['base|read'],
        'tokenA'
      );
    });

    it('falls back to token scopes for list-filtered tools', async () => {
      const { registry, cls, permissionService } = build();
      await registry.invoke('list_spaces', {});

      expect(permissionService.validPermissions).not.toHaveBeenCalled();
      expect(cls.set).toHaveBeenCalledWith('permissions', ['space|read', 'base|read']);
    });
  });

  describe('caps', () => {
    it('clamps query_records take to maxRecordsPerCall', async () => {
      const { registry, services } = build({ config: { maxRecordsPerCall: 10 } });
      await registry.invoke('query_records', { tableId: 'tbl1', take: 9999 });

      const query = (services.recordService.getRecords as any).mock.calls[0][1];
      // +1 is the over-fetch used to compute hasMore.
      expect(query.take).toBe(11);
    });

    it('refuses to delete more than maxDeletePerCall records', async () => {
      const { registry, services } = build({ config: { maxDeletePerCall: 2 } });
      await expect(
        registry.invoke('delete_records', { tableId: 'tbl1', recordIds: ['recA', 'recB', 'recC'] })
      ).rejects.toThrow('Cannot delete more than 2');
      expect(services.recordWriteService.deleteRecords).not.toHaveBeenCalled();
    });

    it('deletes when within the cap and reports recoverability', async () => {
      const { registry, services } = build({ config: { maxDeletePerCall: 2 } });
      const result: any = await registry.invoke('delete_records', {
        tableId: 'tbl1',
        recordIds: ['recA', 'recB'],
      });

      expect(services.recordWriteService.deleteRecords).toHaveBeenCalledWith('tbl1', [
        'recA',
        'recB',
      ]);
      expect(result.recoverable).toBe(true);
    });
  });

  describe('id prefix validation', () => {
    it.each([
      ['list_tables', { baseId: 'spc_wrong_prefix' }],
      ['list_bases', { spaceId: 'bse_wrong_prefix' }],
      ['query_records', { tableId: 'bse_wrong_prefix' }],
      ['get_record', { tableId: 'tbl1', recordId: 'fld_wrong_prefix' }],
      ['delete_view', { tableId: 'tbl1', viewId: 'tbl_wrong_prefix' }],
    ])('%s rejects a wrong-prefix id', async (tool, args) => {
      // A wrong-prefix id can pass the permission check and then match
      // nothing, so the caller is told "empty" instead of "wrong id".
      const { registry, services } = build();
      await expect(registry.invoke(tool, args)).rejects.toThrow();
      expect(services.recordService.getRecords).not.toHaveBeenCalled();
      expect(services.tableService.getTables).not.toHaveBeenCalled();
    });
  });

  describe('query_records paging', () => {
    it('reports hasMore and trims the over-fetched record', async () => {
      const recordService = {
        getRecords: vi.fn(async () => ({
          records: [
            { id: 'r1', fields: {} },
            { id: 'r2', fields: {} },
            { id: 'r3', fields: {} },
          ],
        })),
        getRecord: vi.fn(),
      };
      const { registry } = build({ services: { recordService } });
      const result: any = await registry.invoke('query_records', { tableId: 'tbl1', take: 2 });

      expect(result.returned).toBe(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextSkip).toBe(2);
      expect(result.records).toHaveLength(2);
    });

    it('reports hasMore false when the page is not full', async () => {
      const recordService = {
        getRecords: vi.fn(async () => ({ records: [{ id: 'r1', fields: {} }] })),
        getRecord: vi.fn(),
      };
      const { registry } = build({ services: { recordService } });
      const result: any = await registry.invoke('query_records', { tableId: 'tbl1', take: 2 });

      expect(result.hasMore).toBe(false);
      expect(result.nextSkip).toBeNull();
    });
  });

  describe('field key discipline', () => {
    it('pins fieldKeyType to id on reads', async () => {
      // getRecord defaults to Name internally (record.service.ts:1082), which
      // would make fields[fieldId] silently undefined.
      const { registry, services } = build();
      await registry.invoke('get_record', { tableId: 'tbl1', recordId: 'rec1' });

      const query = (services.recordService.getRecord as any).mock.calls[0][2];
      expect(query.fieldKeyType).toBe('id');
    });

    it('pins fieldKeyType to id on writes', async () => {
      const { registry, services } = build();
      await registry.invoke('create_records', {
        tableId: 'tbl1',
        records: [{ fields: { fldX: 'v' } }],
      });

      const ro = (services.recordWriteService.multipleCreateRecords as any).mock.calls[0][1];
      expect(ro.fieldKeyType).toBe('id');
    });
  });

  describe('update_table', () => {
    it('requires at least one field to change', async () => {
      const { registry } = build();
      await expect(registry.invoke('update_table', { tableId: 'tbl1' })).rejects.toThrow(
        'at least one of name, description or icon'
      );
    });

    it('resolves the owning baseId, which the service requires', async () => {
      const { registry, services } = build();
      await registry.invoke('update_table', { tableId: 'tbl1', name: 'New' });

      expect(services.tableService.updateName).toHaveBeenCalledWith('bse1', 'tbl1', 'New');
    });
  });
});

import { Relationship } from '@teable/core';
import type { ISchemaPackAddRo, ISchemaPackInstallRo } from '@teable/openapi';
import type { ICatalogField } from './schema-pack.catalog';
import { holdsMany, SchemaPackInstallerService } from './schema-pack.installer';

const ro: ISchemaPackInstallRo = {
  spaceId: 'spcTest',
  packs: ['progress'],
  options: {
    baseName: 'Mine',
    timezone: 'UTC',
    currency: 'USD',
    starterRows: false,
    optionalTables: [],
  },
  completeOnboarding: true,
};

const addRo: ISchemaPackAddRo = {
  packs: ['progress'],
  options: { timezone: 'UTC', currency: 'USD', starterRows: false, optionalTables: [] },
};

/** A tiny SET NX EX store, so release really has to match the token it acquired with. */
const fakeRedis = (lockedElsewhere: boolean) => {
  const store = new Map<string, string>();
  return {
    store,
    setnxex: vi.fn(async (key: string, _ttl: number, value: string) => {
      if (lockedElsewhere || store.has(key)) return false;
      store.set(key, value);
      return true;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => void store.delete(key)),
  };
};

const build = (failOnLink: boolean, cacheLocked = false) => {
  let tableNo = 0;
  const services = {
    prismaService: { base: { findFirst: vi.fn(async () => ({ id: 'bseExisting' })) } },
    baseService: {
      createBase: vi.fn(async () => ({ id: 'bseNew' })),
      permanentDeleteBase: vi.fn(async () => undefined),
    },
    tableOpenApiService: {
      createTable: vi.fn(async () => ({ id: `tbl${++tableNo}` })),
      permanentDeleteTables: vi.fn(async () => undefined),
      getTables: vi.fn(async () => [] as { id: string; name: string }[]),
    },
    fieldService: { getField: vi.fn(async (_t: string, id: string) => ({ id, name: 'x' })) },
    fieldOpenApiService: {
      createField: vi.fn(async (_tableId: string, fieldRo: { id: string; type: string }) => {
        if (failOnLink && fieldRo.type === 'link') throw new Error('boom');
        return { id: fieldRo.id, options: { symmetricFieldId: `${fieldRo.id}sym` } };
      }),
      updateField: vi.fn(async () => undefined),
      deleteField: vi.fn(async () => undefined),
      getFields: vi.fn(async () => [] as unknown[]),
    },
    recordOpenApiService: { createRecords: vi.fn(), updateRecords: vi.fn() },
    viewOpenApiService: { createView: vi.fn(async () => ({})) },
    userService: { updateOnboarding: vi.fn(async () => undefined) },
    eventEmitterService: { emitAsync: vi.fn(async () => []) },
    redis: fakeRedis(cacheLocked),
  };
  const user = { id: 'usrMe', name: 'Me', email: 'me@example.com' };
  const cls = {
    get: vi.fn((key: string) => (key === 'user.id' ? user.id : key === 'user' ? user : undefined)),
  };
  const installer = new SchemaPackInstallerService(
    services.prismaService as never,
    services.baseService as never,
    services.tableOpenApiService as never,
    services.fieldService as never,
    services.fieldOpenApiService as never,
    services.recordOpenApiService as never,
    services.viewOpenApiService as never,
    services.userService as never,
    services.eventEmitterService as never,
    services.redis as never,
    cls as never
  );
  return { installer, services };
};

describe('SchemaPackInstallerService', () => {
  it('builds tables, then links, then marks onboarding complete', async () => {
    const { installer, services } = build(false);
    const vo = await installer.install(ro);
    expect(vo.baseId).toBe('bseNew');
    expect(vo.tables.map((t) => t.key)).toEqual(['goals', 'projects', 'tasks']);
    expect(services.tableOpenApiService.createTable).toHaveBeenCalledTimes(3);
    expect(services.userService.updateOnboarding).toHaveBeenCalledWith('usrMe', 'completed');
    expect(services.baseService.permanentDeleteBase).not.toHaveBeenCalled();
  });

  it('emits base.create with the new base, not the install result', async () => {
    const { installer, services } = build(false);
    await installer.install(ro);
    expect(services.eventEmitterService.emitAsync).toHaveBeenCalledTimes(1);
    const [name, event] = services.eventEmitterService.emitAsync.mock.calls[0] as unknown as [
      string,
      { payload: unknown; context: unknown },
    ];
    expect(name).toBe('base.create');
    expect(event.payload).toEqual({ base: { id: 'bseNew', name: 'Mine', spaceId: 'spcTest' } });
    expect(event.context).toMatchObject({ user: { id: 'usrMe' } });
  });

  it('emits nothing when adding to an existing base', async () => {
    const { installer, services } = build(false);
    await installer.addToBase('bseExisting', addRo);
    expect(services.eventEmitterService.emitAsync).not.toHaveBeenCalled();
    expect(services.baseService.createBase).not.toHaveBeenCalled();
  });

  it('deletes the new base when a step fails, keeps onboarding open, and emits nothing', async () => {
    const { installer, services } = build(true);
    await expect(installer.install(ro)).rejects.toThrow('boom');
    expect(services.baseService.permanentDeleteBase).toHaveBeenCalledWith('bseNew', true);
    expect(services.userService.updateOnboarding).not.toHaveBeenCalled();
    expect(services.eventEmitterService.emitAsync).not.toHaveBeenCalled();
  });

  it('attempts every undo step in an existing base, even after one fails', async () => {
    const { installer, services } = build(false);
    // The base already holds goals and projects, so their links are added as fields there.
    services.tableOpenApiService.getTables.mockResolvedValue([
      { id: 'tblGoals', name: 'goals' },
      { id: 'tblProjects', name: 'projects' },
    ]);
    services.fieldOpenApiService.deleteField.mockRejectedValueOnce(new Error('locked'));
    services.viewOpenApiService.createView.mockRejectedValueOnce(new Error('late failure'));
    await expect(installer.addToBase('bseExisting', addRo)).rejects.toThrow('late failure');
    const deletes = services.fieldOpenApiService.deleteField.mock.calls.length;
    const tracked = services.fieldOpenApiService.createField.mock.calls.filter(
      ([tableId]) => tableId === 'tblGoals' || tableId === 'tblProjects'
    ).length;
    expect(deletes).toBeGreaterThan(1);
    expect(deletes).toBeGreaterThanOrEqual(tracked);
    expect(services.tableOpenApiService.permanentDeleteTables).toHaveBeenCalledWith(
      'bseExisting',
      expect.arrayContaining(['tbl1'])
    );
  });

  it('refuses a second concurrent add into the same base with 409', async () => {
    const { installer, services } = build(false);
    let releaseTables: () => void = () => undefined;
    services.tableOpenApiService.getTables
      .mockImplementationOnce(() => new Promise((resolve) => (releaseTables = () => resolve([]))))
      .mockResolvedValue([]);
    const first = installer.addToBase('bseExisting', addRo);
    await vi.waitFor(() => expect(services.tableOpenApiService.getTables).toHaveBeenCalled());
    await expect(installer.addToBase('bseExisting', addRo)).rejects.toMatchObject({
      status: 409,
    });
    releaseTables();
    await expect(first).resolves.toMatchObject({ baseId: 'bseExisting' });
    // The lock is released afterwards: a later add into the same base may proceed.
    await expect(installer.addToBase('bseExisting', addRo)).resolves.toMatchObject({
      baseId: 'bseExisting',
    });
  });

  it('refuses when another instance holds the Redis lock', async () => {
    const { installer } = build(false, true);
    await expect(installer.addToBase('bseElsewhere', addRo)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('releases the cache lock even when the install fails', async () => {
    const { installer, services } = build(true);
    await expect(installer.addToBase('bseFails', addRo)).rejects.toThrow('boom');
    expect(services.redis.del).toHaveBeenCalledWith('schema-pack:install-lock:bseFails');
    expect(services.redis.store.size).toBe(0);
  });

  it('answers 404 for a missing base before taking the lock', async () => {
    const { installer, services } = build(false);
    services.prismaService.base.findFirst.mockResolvedValue(null as never);
    await expect(installer.addToBase('bseGone', addRo)).rejects.toMatchObject({ status: 404 });
    expect(services.redis.setnxex).not.toHaveBeenCalled();
  });
});

describe('holdsMany', () => {
  const owner = { spec: {} } as ICatalogField;
  const symmetric = { symmetricOf: { table: 't', key: 'k' } } as ICatalogField;

  it.each([
    [Relationship.ManyOne, false, true],
    [Relationship.OneMany, true, false],
    [Relationship.ManyMany, true, true],
    [Relationship.OneOne, false, false],
  ])('%s: owner holds many = %s, symmetric holds many = %s', (rel, ownerMany, symMany) => {
    expect(holdsMany(owner, rel)).toBe(ownerMany);
    expect(holdsMany(symmetric, rel)).toBe(symMany);
  });
});

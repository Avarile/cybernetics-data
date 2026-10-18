import type { ISchemaPackInstallRo } from '@teable/openapi';
import { SchemaPackInstallerService } from './schema-pack.installer';

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
    baseService: {
      createBase: vi.fn(async () => ({ id: 'bseNew' })),
      permanentDeleteBase: vi.fn(async () => undefined),
    },
    tableOpenApiService: {
      createTable: vi.fn(async () => ({ id: `tbl${++tableNo}` })),
      permanentDeleteTables: vi.fn(async () => undefined),
    },
    fieldService: { getField: vi.fn(async (_t: string, id: string) => ({ id, name: 'x' })) },
    fieldOpenApiService: {
      createField: vi.fn(async (_tableId: string, fieldRo: { id: string; type: string }) => {
        if (failOnLink && fieldRo.type === 'link') throw new Error('boom');
        return { id: fieldRo.id, options: { symmetricFieldId: `${fieldRo.id}sym` } };
      }),
      updateField: vi.fn(async () => undefined),
      deleteField: vi.fn(async () => undefined),
    },
    viewOpenApiService: { createView: vi.fn(async () => ({})) },
    recordOpenApiService: { createRecords: vi.fn(), updateRecords: vi.fn() },
    userService: { updateOnboarding: vi.fn(async () => undefined) },
    redis: fakeRedis(cacheLocked),
    permissionService: { validPermissions: vi.fn(async () => undefined) },
    prismaService: { base: { findFirst: vi.fn(async () => ({ spaceId: 'spcTest' })) } },
  };
  const cls = { get: vi.fn((key: string) => (key === 'user.id' ? 'usrMe' : undefined)) };
  const installer = new SchemaPackInstallerService(
    services.prismaService as never,
    services.permissionService as never,
    services.baseService as never,
    services.tableOpenApiService as never,
    services.fieldService as never,
    services.fieldOpenApiService as never,
    services.recordOpenApiService as never,
    services.viewOpenApiService as never,
    services.userService as never,
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

  it('deletes the new base when a step fails, and keeps onboarding open', async () => {
    const { installer, services } = build(true);
    await expect(installer.install(ro)).rejects.toThrow('boom');
    expect(services.baseService.permanentDeleteBase).toHaveBeenCalledWith('bseNew', true);
    expect(services.userService.updateOnboarding).not.toHaveBeenCalled();
  });

  it('refuses a second concurrent install into the same base with 409', async () => {
    const { installer, services } = build(false);
    let releaseTables: () => void = () => undefined;
    const getTables = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (releaseTables = () => resolve([]))))
      .mockResolvedValue([]);
    (services.tableOpenApiService as unknown as { getTables: unknown }).getTables = getTables;
    const first = installer.install({ ...ro, baseId: 'bseExisting' });
    await vi.waitFor(() => expect(getTables).toHaveBeenCalled());
    await expect(installer.install({ ...ro, baseId: 'bseExisting' })).rejects.toMatchObject({
      status: 409,
    });
    releaseTables();
    await expect(first).resolves.toMatchObject({ baseId: 'bseExisting' });
    // The lock is released afterwards: a later install into the same base may proceed.
    await expect(installer.install({ ...ro, baseId: 'bseExisting' })).resolves.toMatchObject({
      baseId: 'bseExisting',
    });
  });

  it('refuses when another instance holds the Redis lock', async () => {
    const { installer } = build(false, true);
    await expect(installer.install({ ...ro, baseId: 'bseElsewhere' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('releases the cache lock even when the install fails', async () => {
    const { installer, services } = build(true);
    (services.tableOpenApiService as unknown as { getTables: unknown }).getTables = vi.fn(
      async () => []
    );
    await expect(installer.install({ ...ro, baseId: 'bseFails' })).rejects.toThrow('boom');
    expect(services.redis.del).toHaveBeenCalledWith('schema-pack:install-lock:bseFails');
    expect(services.redis.store.size).toBe(0);
  });

  it('checks access before taking the lock, so outsiders cannot hold it', async () => {
    const { installer, services } = build(false);
    services.permissionService.validPermissions = vi.fn(async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    });
    await expect(installer.install({ ...ro, baseId: 'bseNotMine' })).rejects.toMatchObject({
      status: 403,
    });
    expect(services.redis.setnxex).not.toHaveBeenCalled();
  });
});

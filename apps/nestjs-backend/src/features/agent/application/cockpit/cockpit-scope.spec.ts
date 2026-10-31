import type {
  IAgentStorePort,
  IAuditPort,
  ICockpitDataPort,
  ISchemaCatalogPort,
  ISearchSchema,
} from '../../domain/ports';
import { CockpitScope } from './cockpit-scope';

const bases = [
  { id: 'bseDataCentre', name: 'data-centre', spaceId: 'spc1', spaceName: 'Work' },
  { id: 'bseDemo', name: 'demo_database', spaceId: 'spc1', spaceName: 'Work' },
];

const schema: ISearchSchema = {
  baseId: 'bseDataCentre',
  baseName: 'data-centre',
  tables: [
    { id: 'tblTasks', name: 'tasks', baseId: 'bseDataCentre', fields: [] },
    { id: 'tblAudit', name: 'auditlog', baseId: 'bseDataCentre', fields: [] },
    { id: 'tblKnow', name: 'knowledges', baseId: 'bseDataCentre', fields: [] },
  ],
  excluded: new Set(['tblKnow']),
};

const setup = (opts: { pinned?: string | null; dataBase?: string; profile?: boolean } = {}) => {
  const data = {
    listBases: vi.fn(async () => bases),
    base: vi.fn(async (id: string) => bases.find((b) => b.id === id)),
    table: vi.fn(),
    assertAllowed: vi.fn(async () => undefined),
    search: vi.fn(),
    readRecord: vi.fn(),
  } as unknown as ICockpitDataPort;
  const catalog = {
    dataBase: vi.fn(async () =>
      opts.dataBase ? { id: opts.dataBase, name: opts.dataBase } : undefined
    ),
    schema: vi.fn(async () => schema),
  } as unknown as ISchemaCatalogPort;
  const store = {
    getDefaultProfile: vi.fn(async () =>
      opts.profile === false ? undefined : { id: 'prf1', dataBaseId: opts.pinned ?? null }
    ),
    updateProfile: vi.fn(async () => ({})),
  } as unknown as IAgentStorePort;
  const audit: IAuditPort = { append: vi.fn(async () => undefined) };
  return { scope: new CockpitScope(data, catalog, store, audit), data, catalog, store, audit };
};

describe('CockpitScope', () => {
  it('lists the bases with the default the agent reads', async () => {
    const { scope, catalog } = setup({ pinned: 'bseDemo', dataBase: 'bseDemo' });
    expect(await scope.bases()).toEqual({ bases, defaultBaseId: 'bseDemo' });
    expect(catalog.dataBase).toHaveBeenCalledWith('bseDemo');
  });

  it('has no default the admin cannot open', async () => {
    const { scope } = setup({ dataBase: 'bseElsewhere' });
    expect((await scope.bases()).defaultBaseId).toBeNull();
  });

  it('lists the tables of a base without system tables, excluded ones kept', async () => {
    const { scope, data } = setup();
    expect(await scope.tables('bseDataCentre')).toEqual({
      baseId: 'bseDataCentre',
      tables: [
        { id: 'tblTasks', name: 'tasks' },
        { id: 'tblKnow', name: 'knowledges' },
      ],
    });
    expect(data.assertAllowed).toHaveBeenCalledWith('bseDataCentre', ['table|read']);
  });

  it('404s a base it does not have', async () => {
    const { scope } = setup();
    await expect(scope.tables('bseGone')).rejects.toThrow(/Base not found/);
    await expect(scope.setDefault('usr1', 'bseGone')).rejects.toThrow(/Base not found/);
  });

  it('sets the default base on the profile and audits it', async () => {
    const { scope, store, audit, data } = setup();
    expect(await scope.setDefault('usr1', 'bseDemo')).toEqual({ defaultBaseId: 'bseDemo' });
    expect(data.assertAllowed).toHaveBeenCalledWith('bseDemo', ['record|read']);
    expect(store.updateProfile).toHaveBeenCalledWith('prf1', { dataBaseId: 'bseDemo' });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'cockpit.default_base', actorUserId: 'usr1' })
    );
  });

  it('cannot set a default before the agent is installed', async () => {
    const { scope } = setup({ profile: false });
    await expect(scope.setDefault('usr1', 'bseDemo')).rejects.toThrow(/no profile/);
  });
});

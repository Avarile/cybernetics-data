import { dataCentreSchema } from '../../domain/overview/__fixtures__/data-centre-schema';
import type { IAgentStorePort, IOverviewGraphPort, ISchemaCatalogPort } from '../../domain/ports';
import { GetOverview, OVERVIEW_CACHE_MS } from './get-overview.query';

const setup = (
  base: { id: string; name: string } | null = { id: 'bseDataCentre', name: 'data-centre' }
) => {
  const catalog = {
    dataBase: vi.fn(async () => base ?? undefined),
    schema: vi.fn(async () => dataCentreSchema()),
  } as unknown as ISchemaCatalogPort;
  const graphs: IOverviewGraphPort = {
    assertReadable: vi.fn(async () => undefined),
    read: vi.fn(async () => ({
      nodes: [],
      links: [],
      stats: { perTable: [], truncated: { nodes: false, links: false } },
    })),
  };
  const store = {
    getDefaultProfile: vi.fn(async () => ({ dataBaseId: 'bsePinned' })),
  } as unknown as IAgentStorePort;
  return { query: new GetOverview(catalog, graphs, store), catalog, graphs };
};

describe('GetOverview', () => {
  it('reads the pinned data base once a minute, and checks access every time', async () => {
    const { query, catalog, graphs } = setup();
    const t0 = new Date('2026-10-30T00:00:00Z');
    const first = await query.get('usr1', 'work', t0);
    expect(catalog.dataBase).toHaveBeenCalledWith('bsePinned');
    expect(first).toMatchObject({ dataset: 'work', title: 'WORK', baseId: 'bseDataCentre' });
    await query.get('usr1', 'work', new Date(t0.getTime() + OVERVIEW_CACHE_MS - 1));
    expect(graphs.read).toHaveBeenCalledTimes(1);
    expect(graphs.assertReadable).toHaveBeenCalledTimes(2);
    await query.get('usr1', 'work', new Date(t0.getTime() + OVERVIEW_CACHE_MS));
    expect(graphs.read).toHaveBeenCalledTimes(2);
    // each dataset and each admin has its own
    await query.get('usr2', 'work', t0);
    await query.get('usr1', 'finance', t0);
    expect(graphs.read).toHaveBeenCalledTimes(4);
  });

  it('says when there is no data base to draw', async () => {
    const { query } = setup(null);
    await expect(query.get('usr1', 'work')).rejects.toThrow(/No data base/);
  });
});

import type { IBaseGraphNode, IBaseGraphQueryRo } from '@teable/openapi';
import { dataCentreSchema } from '../../domain/overview/__fixtures__/data-centre-schema';
import type { ICockpitDataPort, IOverviewGraphPort, ISchemaCatalogPort } from '../../domain/ports';
import { OVERVIEW_CACHE_MS } from './get-overview.query';
import { GetTableOverview } from './get-table-overview.query';

const rec = (tableId: string, recordId: string, parentId: string | null): IBaseGraphNode => ({
  id: `rec:${recordId}`,
  kind: 'record',
  tableId,
  recordId,
  label: recordId,
  parentId,
  colorKey: null,
  depth: 0,
  degree: 0,
  values: { kActive: true, ktActive: true },
});

const setup = (nodes: IBaseGraphNode[] = []) => {
  const data = {
    table: vi.fn(async (id: string) =>
      id === 'tblGone' ? undefined : { id, name: id, baseId: 'bseDataCentre' }
    ),
  } as unknown as ICockpitDataPort;
  const catalog = {
    // the agent's search_exclude must not hide a table the admin picked
    schema: vi.fn(async () => dataCentreSchema(undefined, ['tblKnowledges'])),
  } as unknown as ISchemaCatalogPort;
  const graphs: IOverviewGraphPort = {
    assertReadable: vi.fn(async () => undefined),
    read: vi.fn(async () => ({
      nodes,
      links: [],
      stats: { perTable: [], truncated: { nodes: false, links: false } },
    })),
  };
  return { query: new GetTableOverview(data, catalog, graphs), graphs };
};

describe('GetTableOverview', () => {
  it('draws a table by its preset once a minute, checking access every time', async () => {
    const { query, graphs } = setup();
    const t0 = new Date('2026-10-30T00:00:00Z');
    const vo = await query.get('usr1', 'tblKnowledges', t0);
    expect(vo).toMatchObject({
      tableId: 'tblKnowledges',
      tableName: 'knowledges',
      title: 'KNOWLEDGES',
      preset: 'knowledge',
      presentation: { branchTitle: 'TYPES' },
      baseId: 'bseDataCentre',
      missing: [],
    });
    await query.get('usr1', 'tblKnowledges', new Date(t0.getTime() + OVERVIEW_CACHE_MS - 1));
    expect(graphs.read).toHaveBeenCalledTimes(1);
    expect(graphs.assertReadable).toHaveBeenCalledTimes(2);
    await query.get('usr1', 'tblProjects', t0);
    expect(graphs.read).toHaveBeenCalledTimes(2);
  });

  it('404s a table it does not have', async () => {
    const { query } = setup();
    await expect(query.get('usr1', 'tblGone')).rejects.toThrow(/Table not found/);
  });

  it('reads forced records by id, with the branch they hang from and nothing else', async () => {
    const { query, graphs } = setup([
      rec('tblKnowledgeType', 'KT1', null),
      rec('tblKnowledgeType', 'KT2', null),
      rec('tblKnowledges', 'K9', 'rec:KT1'),
      rec('tblKnowledges', 'K8', 'rec:KT2'),
    ]);
    const out = await query.nodes('tblKnowledges', ['K9']);
    const ro = vi.mocked(graphs.read).mock.calls[0][1] as IBaseGraphQueryRo;
    const knowledges = ro.tables.find((t) => t.tableId === 'tblKnowledges')!;
    expect(knowledges.recordIds).toEqual(['K9']);
    expect(knowledges).not.toHaveProperty('filter');
    expect(knowledges).not.toHaveProperty('limit');
    expect(ro.tables.map((t) => t.tableId)).toEqual(['tblKnowledgeType', 'tblKnowledges']);
    expect(ro.linkFieldIds).toEqual([]);
    expect(out.nodes.map((n) => [n.id, n.parent])).toEqual([
      ['rec:KT1', null],
      ['rec:K9', 'rec:KT1'],
    ]);
  });
});

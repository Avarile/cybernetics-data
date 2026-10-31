/* eslint-disable sonarjs/no-duplicate-string */
import { MockLanguageModelV3 } from 'ai/test';
import type {
  IAgentLayoutPort,
  IAgentStorePort,
  IAuditPort,
  ICockpitDataPort,
  ICockpitRecordRow,
  IModelPort,
  ISchemaCatalogPort,
  ISearchSchema,
} from '../../domain/ports';
import { CockpitRecords } from './cockpit-records';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const schema = (excluded: string[] = []): ISearchSchema => ({
  baseId: 'bseDc',
  baseName: 'data-centre',
  tables: [
    {
      id: 'tblKnow',
      name: 'knowledges',
      baseId: 'bseDc',
      fields: [
        { id: 'fTitle', name: 'title', type: 'singleLineText', isPrimary: true },
        { id: 'fBody', name: 'context', type: 'longText' },
      ],
    },
  ],
  excluded: new Set(excluded),
});

const row = (body: string): ICockpitRecordRow => ({
  id: 'recK1',
  cells: { fTitle: 'Deploy K3s', fBody: body },
  lastModifiedTime: '2026-10-30T14:02:00.000Z',
});

const setup = (opts: { body?: string; excluded?: string[]; model?: string | null } = {}) => {
  const calls: string[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      calls.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: 'text', text: '**Deploy** steps for K3s.\n\nPull, then apply.' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
  const data = {
    table: vi.fn(async (id: string) =>
      id === 'tblKnow' ? { id, name: 'knowledges', baseId: 'bseDc' } : undefined
    ),
    assertAllowed: vi.fn(async () => undefined),
    search: vi.fn(async () => ({ records: [row('the deployment runbook')], total: 7 })),
    readRecord: vi.fn(async () => row(opts.body ?? 'short')),
  } as unknown as ICockpitDataPort;
  const catalog = {
    schema: vi.fn(async () => schema(opts.excluded)),
  } as unknown as ISchemaCatalogPort;
  const store = {
    getDefaultProfile: vi.fn(async () => ({
      smallModel: opts.model === undefined ? 'openai/small' : opts.model,
      model: null,
    })),
  } as unknown as IAgentStorePort;
  const layout: IAgentLayoutPort = { layout: vi.fn(async () => ({}) as never) };
  const models = { resolve: vi.fn(async () => ({ model })) } as unknown as IModelPort;
  const audit: IAuditPort = { append: vi.fn(async () => undefined) };
  return {
    records: new CockpitRecords(data, catalog, store, layout, models, audit),
    data,
    calls,
    audit,
  };
};

describe('CockpitRecords', () => {
  it('searches as the table page does and shapes the results', async () => {
    const { records, data } = setup();
    expect(await records.search('tblKnow', 'deploy', 10)).toEqual({
      tableId: 'tblKnow',
      q: 'deploy',
      total: 7,
      results: [
        {
          recordId: 'recK1',
          title: 'Deploy K3s',
          snippet: { field: 'context', text: 'the deployment runbook', match: [4, 10] },
          updatedAt: '2026-10-30T14:02:00.000Z',
        },
      ],
    });
    expect(data.search).toHaveBeenCalledWith('tblKnow', 'deploy', 10);
    expect(data.assertAllowed).toHaveBeenCalledWith('bseDc', ['record|read']);
  });

  it('404s a table or record it does not have', async () => {
    const { records, data } = setup();
    await expect(records.search('tblGone', 'x')).rejects.toThrow(/Table not found/);
    vi.mocked(data.readRecord).mockResolvedValueOnce(undefined);
    await expect(records.read('tblKnow', 'recNope')).rejects.toThrow(/Record not found/);
  });

  it('reads a record as Markdown with its length and version', async () => {
    const { records } = setup({ body: 'runbook' });
    const vo = await records.read('tblKnow', 'recK1');
    expect(vo).toMatchObject({
      tableName: 'knowledges',
      baseId: 'bseDc',
      title: 'Deploy K3s',
      chars: 'Deploy K3s'.length + 'runbook'.length,
      version: '2026-10-30T14:02:00.000Z',
    });
    expect(vo.markdown).toMatch(/^# Deploy K3s/);
  });

  it('summarises a long record once, spoken as one paragraph', async () => {
    const { records, calls, audit } = setup({ body: 'step '.repeat(200) });
    const first = await records.summarize('usr1', 'tblKnow', 'recK1');
    expect(first).toEqual({
      summary: 'Deploy steps for K3s. Pull, then apply.',
      model: 'openai/small',
      cached: false,
    });
    expect((await records.summarize('usr1', 'tblKnow', 'recK1')).cached).toBe(true);
    expect(calls).toHaveLength(1);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'cockpit.summary', status: 'ok' })
    );
  });

  it('refuses a short record, an excluded table and an agent without a model', async () => {
    await expect(setup().records.summarize('usr1', 'tblKnow', 'recK1')).rejects.toThrow(
      /longer than 500/
    );
    const long = 'step '.repeat(200);
    await expect(
      setup({ body: long, excluded: ['tblKnow'] }).records.summarize('usr1', 'tblKnow', 'recK1')
    ).rejects.toThrow(/excluded from the agent/);
    await expect(
      setup({ body: long, model: null }).records.summarize('usr1', 'tblKnow', 'recK1')
    ).rejects.toThrow(/no model/);
  });
});

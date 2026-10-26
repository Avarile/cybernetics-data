import { MockRerankingModelV3 } from 'ai/test';
import type { IModelPort, IRagHit, IRagStorePort } from '../../domain/ports';
import type { EmbeddingSpaces } from './embedding-spaces';
import { bySection, KnowledgeSearch, snippetOf, SNIPPET_MAX } from './knowledge-search';

const hit = (sectionId: number, chunk: string, score: number, extra: Partial<IRagHit> = {}) =>
  ({
    documentId: `doc${sectionId}`,
    sectionId,
    chunkId: sectionId * 10 + Math.round(score * 100),
    collectionId: 'knowledge',
    title: 'Handbook',
    headingPath: `S${sectionId}`,
    sourceRef: 'text:handbook',
    recordId: null,
    baseId: null,
    tableId: null,
    chunk,
    section: chunk,
    score,
    vectorRank: 1,
    keywordRank: null,
    ...extra,
  }) as IRagHit;

describe('knowledge search', () => {
  it('cuts snippets around the first query term', () => {
    const text = `${'filler words here. '.repeat(40)}The payroll run pays travel. ${'more text. '.repeat(40)}`;
    const s = snippetOf(text, 'when is PAYROLL');
    expect(s.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(s).toContain('payroll run pays travel');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(snippetOf('short text', 'x')).toBe('short text');
    expect(snippetOf('a'.repeat(500), 'zzz').startsWith('aaa')).toBe(true);
  });

  it('counts a section once, at its best rank', () => {
    const hits = [hit(1, 'a', 0.9), hit(2, 'b', 0.8), hit(1, 'c', 0.7), hit(3, 'd', 0.6)];
    expect(bySection(hits).map((h) => h.chunk)).toEqual(['a', 'b', 'd']);
  });

  const setup = (hits: IRagHit[], options: { active?: boolean; embedFails?: boolean } = {}) => {
    const rag = {
      listCollections: vi.fn(async () => [
        { id: 'knowledge', isActive: true },
        { id: 'off', isActive: false },
      ]),
      activeSpace: vi.fn(async () =>
        options.active === false
          ? undefined
          : { slug: 's1', model: 'p/emb', dimension: 3, status: 'active' }
      ),
      query: vi.fn(async () => hits),
    } as unknown as IRagStorePort;
    const spaces = {
      problem: vi.fn(async () => undefined),
      embed: vi.fn(async () => {
        if (options.embedFails) throw new Error('provider down');
        return [[1, 0, 0]];
      }),
    } as unknown as EmbeddingSpaces;
    const reranker = new MockRerankingModelV3({
      doRerank: async () => ({
        ranking: [
          { index: 2, relevanceScore: 0.99 },
          { index: 0, relevanceScore: 0.5 },
        ],
      }),
    });
    const models = {
      reranker: vi.fn(async (ref: string) => ({ ref, modelKey: 'k', model: reranker })),
    } as unknown as IModelPort;
    return { search: new KnowledgeSearch(rag, models, spaces), rag };
  };

  it('searches hybrid, reports unknown and switched-off collections, returns snippets', async () => {
    const hits = [
      hit(1, 'Annual leave is 25 days.', 0.03),
      hit(2, 'Expenses', 0.02, { recordId: 'rec1', baseId: 'bse1', tableId: 'tbl1' }),
    ];
    const { search, rag } = setup(hits);
    const out = await search.search({ query: 'leave', collections: ['knowledge', 'off', 'nope'] });
    expect(out.mode).toBe('hybrid');
    expect(out.searched).toEqual(['knowledge']);
    expect(out.failed).toEqual([
      { collection: 'off', error: 'collection is switched off' },
      { collection: 'nope', error: 'no such collection' },
    ]);
    expect(rag.query).toHaveBeenCalledWith(
      expect.objectContaining({ collections: ['knowledge'], space: 's1', pool: 40 })
    );
    expect(out.results[0]).toMatchObject({ sectionId: 1, snippet: 'Annual leave is 25 days.' });
    expect(out.results[1].recordRef).toEqual({ baseId: 'bse1', tableId: 'tbl1', recordId: 'rec1' });
  });

  it('falls back to keywords without an active space or when embedding fails', async () => {
    const noSpace = setup([], { active: false });
    expect((await noSpace.search.search({ query: 'x', collections: ['knowledge'] })).mode).toBe(
      'keyword'
    );
    const failing = setup([], { embedFails: true });
    const out = await failing.search.search({ query: 'x', collections: ['knowledge'] });
    expect(out.mode).toBe('keyword');
    expect(out.warnings[0]).toMatch(/provider down/);
  });

  it('reranks the pool when a rerank model is set, then keeps topK', async () => {
    const hits = [hit(1, 'one', 0.03), hit(2, 'two', 0.02), hit(3, 'three', 0.01)];
    const { search } = setup(hits);
    const out = await search.search({
      query: 'q',
      collections: ['knowledge'],
      rerankModel: 'cohere/rerank-v3.5',
      topK: 1,
    });
    expect(out.mode).toBe('hybrid+rerank');
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ sectionId: 3, score: 0.99 });
  });
});

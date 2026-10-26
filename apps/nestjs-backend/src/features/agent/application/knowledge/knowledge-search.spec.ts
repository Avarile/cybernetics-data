import type { IRagHit, IRagStorePort } from '../../domain/ports';
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

  const setup = (hits: IRagHit[]) => {
    const rag = {
      listCollections: vi.fn(async () => [
        { id: 'knowledge', isActive: true },
        { id: 'off', isActive: false },
      ]),
      query: vi.fn(async () => hits),
    } as unknown as IRagStorePort;
    return { search: new KnowledgeSearch(rag), rag };
  };

  it('searches active collections, reports the others, returns snippets and record refs', async () => {
    const hits = [
      hit(1, 'Annual leave is 25 days.', 0.3),
      hit(2, 'Expenses', 0.2, { recordId: 'rec1', baseId: 'bse1', tableId: 'tbl1' }),
    ];
    const { search, rag } = setup(hits);
    const out = await search.search({ query: 'leave', collections: ['knowledge', 'off', 'nope'] });
    expect(out.searched).toEqual(['knowledge']);
    expect(out.failed).toEqual([
      { collection: 'off', error: 'collection is switched off' },
      { collection: 'nope', error: 'no such collection' },
    ]);
    expect(rag.query).toHaveBeenCalledWith(
      expect.objectContaining({ collections: ['knowledge'], pool: 40 })
    );
    expect(out.results[0]).toMatchObject({ sectionId: 1, snippet: 'Annual leave is 25 days.' });
    expect(out.results[1].recordRef).toEqual({ baseId: 'bse1', tableId: 'tbl1', recordId: 'rec1' });
  });

  it('keeps topK sections', async () => {
    const { search } = setup([hit(1, 'one', 0.3), hit(2, 'two', 0.2), hit(3, 'three', 0.1)]);
    const out = await search.search({ query: 'q', collections: ['knowledge'], topK: 2 });
    expect(out.results.map((r) => r.sectionId)).toEqual([1, 2]);
  });

  it('searches nothing when no collection is usable', async () => {
    const { search, rag } = setup([]);
    const out = await search.search({ query: 'q', collections: ['off'] });
    expect(out.results).toEqual([]);
    expect(rag.query).not.toHaveBeenCalled();
  });
});

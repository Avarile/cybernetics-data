import { buildHybridQuery } from './rag-query';
import { spaceSlug, spaceTable } from './rag-schema';

describe('rag schema helpers', () => {
  it('derives safe space slugs and refuses anything else as a table name', () => {
    expect(spaceSlug('openai/text-embedding-3-small', 1536)).toBe(
      'openai_text_embedding_3_small_1536'
    );
    expect(spaceSlug('"; drop table x; --', 8)).toBe('drop_table_x_8');
    expect(spaceTable('te3s_1536')).toBe('agent_rag.embedding_te3s_1536');
    expect(() => spaceTable('x; drop schema agent_rag')).toThrow(/Bad embedding space slug/);
  });

  it('builds keyword-only SQL without a vector, and binds every user value', () => {
    const { sql, bindings } = buildHybridQuery({
      text: "o'brien",
      collections: ['knowledge'],
      baseIds: ['bse1'],
    });
    expect(sql).not.toContain("o'brien");
    expect(sql).not.toContain('vec AS');
    expect(bindings).toContain("o'brien");
    const hybrid = buildHybridQuery({
      text: 'x',
      collections: ['k'],
      vector: [0.1, 0.2],
      space: 's_2',
    });
    expect(hybrid.sql).toContain('agent_rag.embedding_s_2');
    expect(hybrid.bindings).toContain('[0.1,0.2]');
  });
});

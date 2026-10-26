import { buildHybridQuery, keywordQuery } from './rag-query';
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
    expect(sql).not.toContain('brien');
    expect(sql).not.toContain('vec AS');
    expect(bindings).toContain('brien');
    const hybrid = buildHybridQuery({
      text: 'x',
      collections: ['k'],
      vector: [0.1, 0.2],
      space: 's_2',
    });
    expect(hybrid.sql).toContain('agent_rag.embedding_s_2');
    expect(hybrid.bindings).toContain('[0.1,0.2]');
  });

  it('turns a question into its meaningful terms joined with or', () => {
    expect(keywordQuery('The VPN says E-HANDSHAKE-17, what do I do?')).toBe(
      'vpn or says or e-handshake-17'
    );
    expect(keywordQuery('pgbouncer pool size')).toBe('pgbouncer or pool or size');
    expect(keywordQuery('what is it')).toBe('what or is or it');
    expect(keywordQuery('"exact phrase" -draft')).toBe('"exact phrase" -draft');
    expect(keywordQuery('INV-2041 v2.1 7')).toBe('inv-2041 or v2.1 or 7');
  });
});

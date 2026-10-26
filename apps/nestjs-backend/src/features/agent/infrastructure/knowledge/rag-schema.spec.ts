import { chunkHeading } from './pg-rag-store';
import { buildSearchQuery, cjkBigrams, searchableText, searchTerms } from './rag-query';
import { RAG_SCHEMA_STATEMENTS } from './rag-schema';

describe('knowledge full-text search', () => {
  it('needs no vector extension', () => {
    expect(RAG_SCHEMA_STATEMENTS.join('\n')).not.toMatch(/\bvector\b|embedding|extension/i);
  });

  it('turns a question into its meaningful words, the last one also as a prefix', () => {
    expect(searchTerms('The VPN says E-HANDSHAKE-17, what do I do?')).toEqual({
      terms: ['vpn', 'says', 'e-handshake-17'],
      prefix: null,
      websearch: null,
    });
    expect(searchTerms('k3s cheatsh')).toMatchObject({
      terms: ['k3s', 'cheatsh'],
      prefix: 'cheatsh',
    });
    // a finished word (trailing space) is not a prefix
    expect(searchTerms('pgbouncer pool ').prefix).toBeNull();
    expect(searchTerms('what is it').terms).toEqual(['what', 'is', 'it']);
    expect(searchTerms('"exact phrase" -draft')).toEqual({
      terms: [],
      prefix: null,
      websearch: '"exact phrase" -draft',
    });
  });

  it('searches CJK text by character pairs', () => {
    expect(cjkBigrams('春节值班')).toEqual(['春节', '节值', '值班']);
    expect(cjkBigrams('a 字 b')).toEqual(['字']);
    expect(searchTerms('春节值班怎么安排？').terms).toEqual(
      expect.arrayContaining(['春节', '值班', '安排'])
    );
    expect(searchableText('公司春节放假')).toBe('公司春节放假 公司 司春 春节 节放 放假');
    expect(searchableText('plain text')).toBe('plain text');
  });

  it('binds every user value and searches nothing without terms', () => {
    const built = buildSearchQuery({
      text: "o'brien's notes",
      collections: ['knowledge'],
      baseIds: ['bse1'],
    })!;
    expect(built.sql).not.toContain('brien');
    expect(built.bindings).toEqual(
      expect.arrayContaining(['brien', 'notes', 'notes:*', ['knowledge'], ['bse1']])
    );
    expect(built.sql).toContain('ts_rank_cd');
    expect(buildSearchQuery({ text: '?!', collections: ['knowledge'] })).toBeNull();
    expect(buildSearchQuery({ text: 'vpn', collections: [] })).toBeNull();
  });

  it('says the title once in a chunk heading', () => {
    expect(chunkHeading('VPN setup', 'VPN setup')).toBe('VPN setup');
    expect(chunkHeading('Handbook', 'Handbook › Leave')).toBe('Handbook › Leave');
    expect(chunkHeading('Staff handbook', 'Leave')).toBe('Staff handbook › Leave');
    expect(chunkHeading(null, null)).toBe('');
  });
});

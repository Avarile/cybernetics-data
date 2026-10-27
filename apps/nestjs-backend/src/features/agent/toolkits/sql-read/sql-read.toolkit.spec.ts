import { jsonRows, limitedSql, MAX_SQL_ROWS } from './sql-read.toolkit';

describe('sql_read helpers', () => {
  it('wraps one statement in a row limit', () => {
    expect(limitedSql(' select 1 ;; ')).toBe(
      `select * from (\nselect 1\n) as agent_query limit ${MAX_SQL_ROWS + 1}`
    );
    expect(() => limitedSql('select 1; drop table x')).toThrow(/one statement/);
    expect(() => limitedSql('  ;')).toThrow(/empty/);
  });

  it('keeps the limit when the query ends in a comment', () => {
    const wrapped = limitedSql('select * from t -- every row');
    expect(wrapped.split('\n').at(-1)).toBe(`) as agent_query limit ${MAX_SQL_ROWS + 1}`);
    expect(limitedSql('select /* a */ 1 /* b */')).toContain('limit');
    expect(() => limitedSql('select 1 /* the rest')).toThrow(/Close the/);
  });

  it('turns BigInt counts into strings', () => {
    expect(jsonRows([{ n: BigInt(3), name: 'a' }])).toEqual([{ n: '3', name: 'a' }]);
  });
});

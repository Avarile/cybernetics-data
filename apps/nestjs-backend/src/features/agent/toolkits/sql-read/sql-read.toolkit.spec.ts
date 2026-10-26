import { jsonRows, limitedSql, MAX_SQL_ROWS } from './sql-read.toolkit';

describe('sql_read helpers', () => {
  it('wraps one statement in a row limit', () => {
    expect(limitedSql(' select 1 ;; ')).toBe(
      `select * from (select 1) as agent_query limit ${MAX_SQL_ROWS + 1}`
    );
    expect(() => limitedSql('select 1; drop table x')).toThrow(/one statement/);
    expect(() => limitedSql('  ;')).toThrow(/empty/);
  });

  it('turns BigInt counts into strings', () => {
    expect(jsonRows([{ n: BigInt(3), name: 'a' }])).toEqual([{ n: '3', name: 'a' }]);
  });
});

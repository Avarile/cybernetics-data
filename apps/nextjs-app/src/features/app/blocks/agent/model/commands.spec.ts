/* eslint-disable sonarjs/no-duplicate-string */
import { describe, expect, it } from 'vitest';
import { completed, matchNames, parseInput, resolveName, suggest } from './commands';

const bases = [
  { id: 'bse1', name: 'data-centre' },
  { id: 'bse2', name: 'demo_database' },
  { id: 'bse3', name: 'primary_database_2' },
];
const names = (items: { name: string }[]) => items.map((i) => i.name);

describe('the command line (scope design §6.2, §6.3)', () => {
  it('reads commands, partial names, unknown commands and queries', () => {
    expect(parseInput('  ')).toEqual({ kind: 'empty' });
    expect(parseInput('/')).toEqual({ kind: 'command-name', partial: '' });
    expect(parseInput('/ta')).toEqual({ kind: 'command-name', partial: 'ta' });
    expect(parseInput('/base')).toEqual({ kind: 'base', arg: '', spaced: false });
    expect(parseInput('/BASE  dat ')).toEqual({ kind: 'base', arg: 'dat', spaced: true });
    expect(parseInput('/table Parent Category')).toMatchObject({ arg: 'Parent Category' });
    expect(parseInput('/foo')).toEqual({ kind: 'unknown-command', name: 'foo' });
    expect(parseInput('/basement x')).toEqual({ kind: 'unknown-command', name: 'basement' });
    expect(parseInput(' /base dat')).toEqual({ kind: 'query', text: '/base dat' });
    expect(parseInput('deploy k3s')).toEqual({ kind: 'query', text: 'deploy k3s' });
  });

  it('matches by the start of the name first: /base dat finds data-centre only (D10)', () => {
    expect(names(matchNames(bases, ''))).toEqual(names(bases));
    expect(names(matchNames(bases, 'd'))).toEqual(['data-centre', 'demo_database']);
    expect(names(matchNames(bases, 'dat'))).toEqual(['data-centre']);
    expect(names(matchNames(bases, 'DAT'))).toEqual(['data-centre']);
    // only when nothing starts with it: a word that does
    expect(names(matchNames(bases, 'centre'))).toEqual(['data-centre']);
    expect(names(matchNames(bases, 'database'))).toEqual(['demo_database', 'primary_database_2']);
    expect(names(matchNames([{ id: 't', name: 'financeTransactions' }], 'trans'))).toEqual([
      'financeTransactions',
    ]);
  });

  it('resolves a name exactly, or when only one matches', () => {
    expect(resolveName(bases, 'Data-Centre')?.id).toBe('bse1');
    expect(resolveName(bases, 'dat')?.id).toBe('bse1');
    expect(resolveName(bases, 'd')).toBeUndefined();
    expect(resolveName(bases, 'nope')).toBeUndefined();
    expect(resolveName(bases, '')).toBeUndefined();
  });

  it('suggests commands, then bases (the default first) or tables', () => {
    expect(suggest(parseInput('/'), bases, [])).toEqual([
      { kind: 'command', name: 'base' },
      { kind: 'command', name: 'table' },
    ]);
    expect(suggest(parseInput('/t'), bases, [])).toEqual([{ kind: 'command', name: 'table' }]);
    const all = suggest(parseInput('/base '), bases, [], 'bse2');
    expect(all.map((s) => (s.kind === 'base' ? [s.name, s.isDefault] : s.kind))).toEqual([
      ['demo_database', true],
      ['data-centre', false],
      ['primary_database_2', false],
    ]);
    const tables = [{ id: 'tbl1', name: 'tasks' }];
    expect(suggest(parseInput('/table ta'), bases, tables)).toEqual([
      { kind: 'table', id: 'tbl1', name: 'tasks' },
    ]);
    expect(suggest(parseInput('deploy'), bases, tables)).toEqual([]);
    expect(completed({ kind: 'command', name: 'table' })).toBe('/table ');
    expect(completed({ kind: 'base', id: 'bse1', name: 'data-centre' })).toBe('/base data-centre');
  });
});

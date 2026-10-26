import type { IMemory } from '../entities';
import { approvalFor, BULK_WRITE_THRESHOLD } from './approval-policy';
import {
  DEFAULT_CONTEXT_BUDGET,
  MIN_HISTORY_BUDGET,
  estimateTokens,
  fitFirst,
  fitNewest,
  historyBudget,
} from './context-budget';
import { inScope, isLive, rankMemories } from './memory-ranking';

describe('ContextBudget', () => {
  it('estimates about 4 characters per token', () => {
    expect(estimateTokens('abcd'.repeat(10))).toBe(10);
    expect(estimateTokens(null)).toBe(0);
  });

  it('gives history what the system prompt leaves, with a floor', () => {
    expect(historyBudget(10_000, 3_000)).toBe(7_000);
    expect(historyBudget(null, 0)).toBe(DEFAULT_CONTEXT_BUDGET);
    expect(historyBudget(4_000, 3_900)).toBe(MIN_HISTORY_BUDGET);
  });

  it('keeps the newest messages that fit, in order, and always the newest one', () => {
    const items = [10, 20, 30, 40];
    expect(fitNewest(items, (n) => n, 75)).toEqual({ kept: [30, 40], dropped: 2 });
    expect(fitNewest(items, (n) => n, 100)).toEqual({ kept: items, dropped: 0 });
    expect(fitNewest([500], (n) => n, 10)).toEqual({ kept: [500], dropped: 0 });
    expect(fitNewest([], (n: number) => n, 10)).toEqual({ kept: [], dropped: 0 });
  });

  it('keeps the first ranked items that fit', () => {
    expect(fitFirst([5, 5, 5], (n) => n, 12)).toEqual([5, 5]);
  });
});

describe('ApprovalPolicy', () => {
  const del = { category: 'delete_records' as const };
  const bulk = {
    category: 'bulk_write' as const,
    when: (i: { records: unknown[] }) => i.records.length > BULK_WRITE_THRESHOLD,
  };

  it('asks only for categories the profile lists', () => {
    expect(approvalFor(del, ['delete_records'])).toBe(true);
    expect(approvalFor(del, [])).toBe(false);
    expect(approvalFor(undefined, ['delete_records'])).toBe(false);
  });

  it('checks per call when the rule has a condition', () => {
    const check = approvalFor(bulk, ['bulk_write']) as (i: { records: unknown[] }) => boolean;
    expect(check({ records: new Array(51) })).toBe(true);
    expect(check({ records: new Array(50) })).toBe(false);
  });

  it('always asks for rules marked always', () => {
    expect(approvalFor({ category: 'delete_schema', always: true }, [])).toBe(true);
  });
});

describe('MemoryRanking', () => {
  const now = new Date('2026-10-27T00:00:00Z');
  const memory = (over: Partial<IMemory>): IMemory => ({
    id: 'rec',
    title: '',
    content: null,
    kind: 'fact',
    scope: 'global',
    scopeRef: null,
    pinned: false,
    importance: 3,
    source: 'user_said',
    sourceThreadId: null,
    tags: [],
    useCount: 0,
    lastUsedAt: null,
    expiresAt: null,
    embeddedAt: null,
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  });

  it('drops forgotten and expired memories', () => {
    expect(isLive(memory({ isActive: false }), now)).toBe(false);
    expect(isLive(memory({ expiresAt: '2026-10-26' }), now)).toBe(false);
    expect(isLive(memory({ expiresAt: '2026-12-01' }), now)).toBe(true);
  });

  it('applies scope', () => {
    const scope = { userId: 'usrA', baseId: 'bseB', threadId: 'recT' };
    expect(inScope(memory({ scope: 'user', scopeRef: 'usrA' }), scope)).toBe(true);
    expect(inScope(memory({ scope: 'user', scopeRef: 'usrZ' }), scope)).toBe(false);
    expect(inScope(memory({ scope: 'base', scopeRef: 'bseB' }), scope)).toBe(true);
    expect(inScope(memory({ scope: 'thread', scopeRef: 'recX' }), scope)).toBe(false);
  });

  it('ranks by shared words, then importance; pinned ones are not ranked', () => {
    const ranked = rankMemories(
      [
        memory({ id: 'a', title: 'Invoices go to finance@acme.test' }),
        memory({
          id: 'b',
          title: 'Invoice numbering',
          content: 'Invoices use INV-0001',
          importance: 5,
        }),
        memory({ id: 'c', title: 'Office in Sydney' }),
        memory({ id: 'd', title: 'Invoices pinned', pinned: true }),
      ],
      'Where do invoices go?',
      { now }
    );
    expect(ranked.map((m) => m.id)).toEqual(['b', 'a']);
    expect(rankMemories([memory({ title: 'x' })], '?!', { now })).toEqual([]);
  });
});

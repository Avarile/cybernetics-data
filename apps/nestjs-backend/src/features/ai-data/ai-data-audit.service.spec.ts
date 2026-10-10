/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiDataAuditService } from './ai-data-audit.service';

const makeCache = () => {
  const counts = new Map<string, number>();
  return {
    counts,
    incr: vi.fn(async (key: string) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key) as number;
    }),
  };
};

const build = (rateLimitPerMinute: number) => {
  const cache = makeCache();
  const service = new AiDataAuditService({ rateLimitPerMinute } as any, cache as any);
  return { service, cache };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiDataAuditService.checkRate', () => {
  it('allows up to the limit per user and minute, then answers 429', async () => {
    const { service, cache } = build(3);
    for (let i = 0; i < 3; i++) await service.checkRate('usr1');
    await expect(service.checkRate('usr1')).rejects.toMatchObject({ status: 429 });
    // Another user has their own budget.
    await expect(service.checkRate('usr2')).resolves.toBeUndefined();

    const [key, ttl] = cache.incr.mock.calls[0] as unknown as [string, number];
    expect(key).toMatch(/^ai-data:rate:usr1:\d+$/);
    expect(ttl).toBe(120);
  });

  it('is off when the limit is 0', async () => {
    const { service, cache } = build(0);
    for (let i = 0; i < 10; i++) await service.checkRate('usr1');
    expect(cache.incr).not.toHaveBeenCalled();
  });
});

describe('AiDataAuditService.record', () => {
  it('writes one JSON line with metadata only, as a warning when the call failed', () => {
    const { service } = build(0);
    const logger = (service as any).logger;
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    service.record({
      op: 'queryRecords',
      userId: 'usr1',
      baseId: 'bse1',
      table: 'tasks',
      via: 'session',
      ok: true,
      rows: 2,
      ms: 5,
    });
    service.record({
      op: 'listTables',
      userId: 'usr1',
      baseId: 'bse2',
      via: 'internal-api',
      ok: false,
      status: 403,
      ms: 1,
    });

    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      event: 'ai_data_access',
      op: 'queryRecords',
      userId: 'usr1',
      baseId: 'bse1',
      table: 'tasks',
      via: 'session',
      ok: true,
      rows: 2,
      ms: 5,
    });
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ ok: false, status: 403 });
  });
});

describe('AiDataAuditService helpers', () => {
  it('statusOf reads HTTP status and treats anything else as 500', () => {
    expect(AiDataAuditService.statusOf(new ForbiddenException())).toBe(403);
    expect(AiDataAuditService.statusOf(new Error('x'))).toBe(500);
  });

  it('rowsOf counts lists and record pages, and nothing else', () => {
    expect(AiDataAuditService.rowsOf([1, 2])).toBe(2);
    expect(AiDataAuditService.rowsOf({ returned: 4, records: [] })).toBe(4);
    expect(AiDataAuditService.rowsOf({ id: 'tbl1', fields: [] })).toBeUndefined();
  });
});

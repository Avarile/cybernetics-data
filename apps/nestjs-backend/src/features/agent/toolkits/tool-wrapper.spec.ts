/* eslint-disable @typescript-eslint/naming-convention */
import { HttpErrorCode } from '@cybernetics/core';
import { z } from 'zod';
import { CustomHttpException } from '../../../custom.exception';
import type { IAgentProfile } from '../domain/entities';
import type { IAuditEntry } from '../domain/ports';
import { auditJson } from '../domain/redact';
import { phaseAfter } from '../domain/search/turn-protocol';
import type { AgentExecutionContext } from '../infrastructure/execution-context';
import { capResult, shapeResult, UNTRUSTED_NOTICE, wrapTool } from './tool-wrapper';
import type { IAgentToolDef, IToolContext } from './toolkit.types';

const profile = { approvalRequired: ['delete_records'] } as unknown as IAgentProfile;
const ctx: IToolContext = { runId: 'run1', actorUserId: 'usrAdmin', profile };

const setup = () => {
  const entries: IAuditEntry[] = [];
  const runs: unknown[] = [];
  const deps = {
    audit: { append: vi.fn(async (e: IAuditEntry) => void entries.push(e)) },
    execution: {
      run: vi.fn(async (scope: unknown, fn: () => Promise<unknown>) => {
        runs.push(scope);
        return fn();
      }),
    } as unknown as AgentExecutionContext,
    maxResultChars: 200,
  };
  return { entries, runs, deps };
};

const call = (tool: ReturnType<typeof wrapTool>, input: unknown) =>
  (tool.execute as (i: unknown, o: object) => Promise<unknown>)(input, {
    toolCallId: 't1',
    messages: [],
  });

describe('tool-wrapper', () => {
  const echo: IAgentToolDef<{ text: string }> = {
    name: 'echo',
    description: 'echo',
    input: z.object({ text: z.string() }),
    execute: async ({ text }) => ({ text }),
  };

  it('runs as the agent and audits the call', async () => {
    const { entries, runs, deps } = setup();
    const result = await call(wrapTool(echo, ctx, deps), { text: 'hi' });
    expect(result).toEqual({ text: 'hi' });
    expect(runs).toEqual([{ runId: 'run1', actorUserId: 'usrAdmin' }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      runId: 'run1',
      actorUserId: 'usrAdmin',
      tool: 'echo',
      args: { text: 'hi' },
      status: 'ok',
    });
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sets needsApproval from the profile', () => {
    const { deps } = setup();
    const del = { ...echo, name: 'del', approval: { category: 'delete_records' as const } };
    expect(wrapTool(del, ctx, deps).needsApproval).toBe(true);
    const write = { ...echo, name: 'w', approval: { category: 'bulk_write' as const } };
    expect(wrapTool(write, ctx, deps).needsApproval).toBe(false);
  });

  it('caps big results and fences untrusted ones', async () => {
    expect(capResult({ a: 'x'.repeat(10) }, 1000)).toEqual({ a: 'x'.repeat(10) });
    const capped = capResult({ a: 'x'.repeat(500) }, 100) as {
      truncated: boolean;
      preview: string;
    };
    expect(capped.truncated).toBe(true);
    expect(capped.preview).toHaveLength(100);
    expect(shapeResult({ a: 1 }, true, 100)).toEqual({
      untrusted_data: { a: 1 },
      notice: UNTRUSTED_NOTICE,
    });

    const { deps } = setup();
    const big = { ...echo, untrusted: true, execute: async () => ({ cell: 'y'.repeat(1000) }) };
    const out = (await call(wrapTool(big, ctx, deps), { text: '' })) as {
      untrusted_data: { truncated: boolean };
    };
    expect(out.untrusted_data.truncated).toBe(true);
  });

  it('keeps the named keys of a capped result, so the turn protocol still reads the status', async () => {
    const { deps } = setup();
    const search = {
      ...echo,
      name: 'plan_search',
      untrusted: true,
      keepOnCap: ['status', 'next', 'absent'],
      execute: async () => ({ status: 'done', steps: ['z'.repeat(1000)], next: 'Answer.' }),
    };
    const out = (await call(wrapTool(search, ctx, deps), { text: '' })) as {
      untrusted_data: Record<string, unknown>;
    };
    expect(out.untrusted_data).toMatchObject({ status: 'done', next: 'Answer.', truncated: true });
    expect(out.untrusted_data).not.toHaveProperty('steps');
    expect(out.untrusted_data).not.toHaveProperty('absent');
    expect(phaseAfter('intent', [{ toolName: 'plan_search', output: out }])).toBe('answer');
  });

  it('turns errors into results the model can read', async () => {
    const { entries, deps } = setup();
    const userError = {
      ...echo,
      execute: async () => {
        throw new CustomHttpException('Table not found', HttpErrorCode.NOT_FOUND);
      },
    };
    expect(await call(wrapTool(userError, ctx, deps), { text: '' })).toEqual({
      error: 'Table not found',
    });
    const internal = {
      ...echo,
      execute: async () => {
        throw new Error('relation "bse1.secret_table" does not exist');
      },
    };
    const out = (await call(wrapTool(internal, ctx, deps), { text: '' })) as { error: string };
    expect(out.error).toMatch(/internal error/);
    expect(out.error).not.toMatch(/secret_table/);
    expect(entries.map((e) => e.status)).toEqual(['error', 'error']);
  });

  it('a failing audit write does not fail the tool', async () => {
    const { deps } = setup();
    deps.audit.append.mockRejectedValueOnce(new Error('db down'));
    expect(await call(wrapTool(echo, ctx, deps), { text: 'ok' })).toEqual({ text: 'ok' });
  });

  it('redacts secrets in what the audit row stores', async () => {
    const { entries, deps } = setup();
    const http = {
      ...echo,
      input: z.object({ headers: z.record(z.string(), z.string()) }),
      execute: async () => ({ status: 200, token: 'ghp_returned' }),
    };
    await call(wrapTool(http, ctx, deps), {
      headers: { Authorization: 'Bearer ghp_secret', Accept: 'json' },
    });
    const stored = auditJson(entries[0].args);
    expect(stored).not.toContain('ghp_secret');
    expect(stored).toContain('[redacted]');
    expect(entries[0].resultSummary).not.toContain('ghp_returned');
  });
});

/* eslint-disable sonarjs/no-duplicate-string */
import { MockLanguageModelV3 } from 'ai/test';
import type { IMemory, IMessage, IThread } from '../../domain/entities';
import type { IAgentStorePort, IModelPort, IRunStorePort } from '../../domain/ports';
import { priceOf } from '../../infrastructure/llm/provider-model.adapter';
import { jobsFor } from './agent-jobs';
import { cleanTitle, costUsd, findDuplicate, looksSecret, TurnJobs } from './turn-jobs';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const replies = (texts: string[]) => {
  const prompts: string[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: 'text', text: texts.shift() ?? '' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
  return { model, prompts };
};

function setup(model: MockLanguageModelV3) {
  const thread: IThread = {
    id: 'recT',
    // the placeholder RunTurn sets: the first 60 characters of the first message
    title: 'Can you clean up the duplicate invoices in the finance base?'.slice(0, 60),
    summary: null,
    costUsd: null,
  } as IThread;
  const messages: IMessage[] = [
    {
      id: 'm1',
      role: 'user',
      seq: 1,
      content: 'Can you clean up the duplicate invoices in the finance base?',
    },
    { id: 'm2', role: 'assistant', seq: 2, content: 'Done. I merged 12 duplicates.' },
  ] as IMessage[];
  const memories: IMemory[] = [];
  const store = {
    getDefaultProfile: async () => ({ smallModel: 'openai/mini', model: 'openai/big' }),
    getThread: async () => thread,
    updateThread: async (_: string, patch: Partial<IThread>) => Object.assign(thread, patch),
    listMessages: async (_: string, o?: { last?: number }) =>
      o?.last ? messages.slice(-o.last) : messages,
    listMemories: async () => [...memories],
    createMemory: async (input: Partial<IMemory>) => {
      const m = {
        id: `rec${memories.length + 1}`,
        scope: 'global',
        scopeRef: null,
        ...input,
      } as IMemory;
      memories.push(m);
      return m;
    },
    updateMemory: async (id: string, patch: Partial<IMemory>) =>
      Object.assign(memories.find((m) => m.id === id)!, patch),
  } as unknown as IAgentStorePort;
  const runs = {
    get: async () => ({
      id: 'run1',
      model: 'openai/big',
      usage: { inputTokens: 1000, outputTokens: 500, steps: 2 },
    }),
  } as unknown as IRunStorePort;
  const models = {
    resolve: vi.fn(async (ref: string) => ({ ref, modelKey: ref, model })),
    price: vi.fn(async () => ({ input: 0.000002, output: 0.000008 })),
  } as unknown as IModelPort;
  const jobs = new TurnJobs(store, runs, models);
  const data = { threadId: 'recT', runId: 'run1', actorUserId: 'usrA' };
  return { jobs, thread, messages, memories, models, data };
}

describe('jobsFor', () => {
  it('queues usage always, title on the first answered turn, summary when trimmed, extraction in auto mode', () => {
    expect(
      jobsFor({ status: 'done', droppedMessages: 0, firstTurn: true, memoryMode: 'auto' })
    ).toEqual(['usage', 'title', 'memory-extract']);
    expect(
      jobsFor({ status: 'failed', droppedMessages: 3, firstTurn: true, memoryMode: 'auto' })
    ).toEqual(['usage', 'summary']);
    expect(
      jobsFor({ status: 'done', droppedMessages: 0, firstTurn: false, memoryMode: 'explicit' })
    ).toEqual(['usage']);
  });
});

describe('TurnJobs', () => {
  it('titles a new thread with the small model', async () => {
    const { model } = replies(['"Invoice duplicate cleanup."']);
    const s = setup(model);
    await s.jobs.title(s.data);
    expect(s.thread.title).toBe('Invoice duplicate cleanup');
    expect(s.models.resolve).toHaveBeenCalledWith('openai/mini');
  });

  it('keeps a title the admin changed', async () => {
    const { model } = replies(['Something else']);
    const s = setup(model);
    s.thread.title = 'My own name';
    await s.jobs.title(s.data);
    expect(s.thread.title).toBe('My own name');
  });

  it('folds dropped messages into the summary', async () => {
    const r = replies(['Admin asked to merge duplicate invoices; 12 merged.']);
    const s = setup(r.model);
    await s.jobs.summary({ ...s.data, droppedMessages: 0 });
    expect(s.thread.summary).toBeNull();
    await s.jobs.summary({ ...s.data, droppedMessages: 2 });
    expect(s.thread.summary).toBe('Admin asked to merge duplicate invoices; 12 merged.');
    expect(r.prompts[0]).toContain('merged 12 duplicates');
  });

  it('extracts memories, updates duplicates instead of adding, and drops secrets', async () => {
    const first = JSON.stringify({
      items: [
        {
          title: 'Finance base holds invoices',
          content: 'Invoices live in the finance base',
          kind: 'fact',
          scope: 'global',
        },
        {
          title: 'Prefers merging duplicates',
          content: 'Merge, do not delete',
          kind: 'preference',
          scope: 'user',
        },
        { title: 'API key', content: 'sk-abcdef1234567890', kind: 'fact', scope: 'global' },
      ],
    });
    const second = JSON.stringify({
      items: [
        {
          title: 'finance base holds invoices',
          content: 'Invoices and receipts live there',
          kind: 'fact',
          scope: 'global',
        },
      ],
    });
    const { model } = replies([first, second]);
    const s = setup(model);
    expect(await s.jobs.extractMemories(s.data)).toEqual({ created: 2, updated: 0 });
    expect(s.memories.map((m) => [m.title, m.source, m.scopeRef])).toEqual([
      ['Finance base holds invoices', 'agent_inferred', null],
      ['Prefers merging duplicates', 'agent_inferred', 'usrA'],
    ]);
    expect(await s.jobs.extractMemories(s.data)).toEqual({ created: 0, updated: 1 });
    expect(s.memories).toHaveLength(2);
    expect(s.memories[0].content).toBe('Invoices and receipts live there');
  });

  it('adds the run cost to the thread', async () => {
    const { model } = replies([]);
    const s = setup(model);
    await s.jobs.usage(s.data);
    expect(s.thread.costUsd).toBeCloseTo(0.006, 6);
  });
});

describe('helpers', () => {
  it('cleans titles, spots secrets, finds near-duplicates, prices models', () => {
    expect(cleanTitle('  "Weekly report."  ')).toBe('Weekly report');
    expect(looksSecret('token ghp_abcdefghijk1234')).toBe(true);
    expect(looksSecret('the office is in Sydney')).toBe(false);
    const existing = [{ title: 'Office in Sydney Australia' } as IMemory];
    expect(findDuplicate(existing, 'office in sydney australia')).toBe(existing[0]);
    expect(findDuplicate(existing, 'Office in Melbourne')).toBeUndefined();
    expect(
      costUsd({ inputTokens: 1_000_000, outputTokens: 0, steps: 1 }, { input: 0.000001, output: 0 })
    ).toBe(1);
    expect(priceOf({ pricing: { input: '0.000003', output: '0.000015' } })).toEqual({
      input: 0.000003,
      output: 0.000015,
    });
    expect(priceOf({ inputRate: 100, outputRate: 200 })).toEqual({
      input: 0.000001,
      output: 0.000002,
    });
    expect(priceOf({ label: 'x' })).toBeUndefined();
  });
});

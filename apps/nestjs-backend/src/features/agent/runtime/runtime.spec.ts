/* eslint-disable sonarjs/no-duplicate-string */
import { z } from 'zod';
import type { IAgentProfile, IMemory, IMessage, ISkill } from '../domain/entities';
import type { IAgentStorePort } from '../domain/ports';
import type { AgentExecutionContext } from '../infrastructure/execution-context';
import { ToolkitRegistry } from '../toolkits/toolkit.registry';
import type { IToolkit } from '../toolkits/toolkit.types';
import { buildSystemPrompt, ContextBuilder } from './context-builder';
import { toUIMessage } from './message-mapper';
import { ToolAssembler } from './tool-assembler';

const profile = (over: Partial<IAgentProfile> = {}): IAgentProfile => ({
  id: 'recP',
  name: 'Agent',
  isDefault: true,
  isActive: true,
  persona: 'You are Ada.',
  model: 'openai/gpt-4.1',
  smallModel: null,
  knowledgeTables: [],
  temperature: null,
  maxSteps: 25,
  maxOutputTokens: 8000,
  contextBudgetTokens: 3000,
  toolkits: ['memory'],
  approvalRequired: [],
  memoryMode: 'explicit',
  alwaysSkillIds: [],
  ...over,
});

const memory = (over: Partial<IMemory>): IMemory =>
  ({
    id: 'm',
    title: '',
    content: null,
    scope: 'global',
    pinned: false,
    isActive: true,
    tags: [],
    importance: 3,
    createdAt: null,
    expiresAt: null,
    ...over,
  }) as IMemory;
const skill = (over: Partial<ISkill>): ISkill =>
  ({
    id: 's',
    name: 'x',
    description: 'd',
    body: 'b',
    invocation: 'auto',
    isActive: true,
    ...over,
  }) as ISkill;
const message = (seq: number, chars: number): IMessage =>
  ({
    id: `rec${seq}`,
    seq,
    role: seq % 2 ? 'user' : 'assistant',
    content: 'w'.repeat(chars),
    parts: null,
  }) as IMessage;

describe('buildSystemPrompt', () => {
  it('puts persona, rules, focus, memories, skills and summary in a fixed order', () => {
    const prompt = buildSystemPrompt({
      persona: 'You are Ada.',
      now: new Date('2026-10-27T10:00:00Z'),
      toolkits: [{ id: 'memory', title: 'Memory' }],
      focus: { baseId: 'bse1', tableId: 'tbl1' },
      pinned: [memory({ title: 'Prefers metric', content: 'kg' })],
      relevant: [memory({ title: 'Office in Sydney' })],
      catalog: [skill({ name: 'rag-search', description: 'Search documents' })],
      always: [skill({ name: 'house-style', body: 'Be brief.' })],
      summary: 'They asked about invoices.',
    });
    const order = [
      'You are Ada.',
      'Today is 2026-10-27',
      'untrusted_data',
      'base bse1, table tbl1',
      '- Prefers metric: kg',
      'Possibly relevant:',
      '- rag-search: Search documents',
      '## Skill: house-style\nBe brief.',
      'They asked about invoices.',
    ].map((s) => prompt.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('ContextBuilder', () => {
  const store = (memories: IMemory[], messages: IMessage[], skills: ISkill[] = []) =>
    ({
      listMemories: vi.fn(async () => memories),
      listSkills: vi.fn(async () => skills),
      listMessages: vi.fn(async () => messages),
    }) as unknown as IAgentStorePort;

  it('trims history to the budget, newest first, and reports what was used', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => message(i + 1, 2000)); // 500 tokens each
    const builder = new ContextBuilder(
      store(
        [
          memory({ id: 'pin', title: 'Pinned rule', pinned: true }),
          memory({ id: 'rel', title: 'Invoices go to finance' }),
          memory({ id: 'other', title: 'Unrelated', scope: 'user', scopeRef: 'usrZ' }),
        ],
        messages
      )
    );
    const built = await builder.build({
      profile: profile({ contextBudgetTokens: 3000 }),
      ctx: { runId: 'r', actorUserId: 'usrA', threadId: 'recT', profile: profile() },
      toolkits: [],
      userText: 'where do invoices go',
    });
    expect(built.messages.length).toBeGreaterThan(0);
    expect(built.messages.length).toBeLessThan(10);
    expect(built.droppedMessages).toBe(10 - built.messages.length);
    expect(built.messages.at(-1)!.id).toBe('rec10');
    expect(built.memoryIds).toEqual(['pin', 'rel']);
  });

  it('skips memories entirely when memory is off', async () => {
    const s = store([memory({ id: 'pin', pinned: true, title: 'x' })], []);
    const built = await new ContextBuilder(s).build({
      profile: profile({ memoryMode: 'off' }),
      ctx: { runId: 'r', actorUserId: 'usrA', profile: profile() },
      toolkits: [],
      userText: 'x',
    });
    expect(built.memoryIds).toEqual([]);
    expect(s.listMemories).not.toHaveBeenCalled();
  });
});

describe('message mapper', () => {
  it('uses stored parts, else the text, and skips tool rows', () => {
    const parts = JSON.stringify([{ type: 'text', text: 'from parts' }]);
    expect(toUIMessage({ ...message(1, 3), parts })!.parts).toEqual([
      { type: 'text', text: 'from parts' },
    ]);
    expect(toUIMessage({ ...message(1, 3), parts: '{broken' })!.parts).toEqual([
      { type: 'text', text: 'www' },
    ]);
    expect(toUIMessage({ ...message(1, 3), role: 'tool' })).toBeUndefined();
  });
});

describe('ToolAssembler', () => {
  const memoryKit: IToolkit = {
    id: 'memory',
    title: 'Memory',
    tools: [
      { name: 'memory_search', description: 'd', input: z.object({}), execute: async () => [] },
    ],
  };
  const knowledgeKit: IToolkit = {
    id: 'knowledge',
    title: 'Knowledge',
    tools: [{ name: 'search', description: 'd', input: z.object({}), execute: async () => [] }],
    unavailable: (p) => (p.smallModel ? undefined : 'no small model'),
  };

  it('wraps the enabled toolkits and reports the ones it skipped', () => {
    const registry = new ToolkitRegistry();
    registry.register(memoryKit);
    registry.register(knowledgeKit);
    const assembler = new ToolAssembler(
      registry,
      { append: vi.fn() },
      {} as AgentExecutionContext,
      { maxResponseChars: 1000 } as never
    );
    const p = profile({ toolkits: ['memory', 'knowledge', 'http', 'bogus'] });
    const out = assembler.assemble({ runId: 'r', actorUserId: 'u', profile: p });
    expect(Object.keys(out.tools)).toEqual(['memory_search']);
    expect(out.toolkits).toEqual([{ id: 'memory', title: 'Memory' }]);
    expect(out.skipped).toEqual([
      { id: 'knowledge', reason: 'no small model' },
      { id: 'http', reason: 'not available in this version' },
      { id: 'bogus', reason: 'unknown toolkit' },
    ]);
  });

  it('refuses duplicate toolkits and tool names', () => {
    const registry = new ToolkitRegistry();
    registry.register(memoryKit);
    expect(() => registry.register(memoryKit)).toThrow(/twice/);
    expect(() => registry.register({ ...knowledgeKit, tools: memoryKit.tools })).toThrow(
      /memory_search/
    );
  });
});

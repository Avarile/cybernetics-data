/* eslint-disable no-console */
/**
 * Load test (P5): a thread with 500 messages. Writing them, reading the whole thread over HTTP,
 * turns on that thread (history window and context budget, summary of what was dropped), and
 * deleting it. Prints timings; the limits are generous, to catch something quadratic rather than
 * to benchmark the machine.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { getAgentThreadMessages } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { RunTurn } from '../src/features/agent/application/chat/run-turn.usecase';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import {
  DEFAULT_CONTEXT_BUDGET,
  estimateTokens,
} from '../src/features/agent/domain/policies/context-budget';
import {
  AGENT_STORE_PORT,
  MODEL_PORT,
  type IAgentStorePort,
  type IModelPort,
} from '../src/features/agent/domain/ports';
import type { IClsStore } from '../src/types/cls';
import { until } from './utils/agent-rag';
import { drain, say, scriptedModel, type IScript } from './utils/agent-script';
import { initApp, runWithTestUser } from './utils/init-app';

const total = 500;
const filler = (i: number) =>
  `Message ${i}: ${'the quarterly numbers for EMEA were discussed in detail again '.repeat(6)}`;

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

describe('Agent load: a 500-message thread (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let home: IAgentInstallationView;
  let store: IAgentStorePort;
  let current: ReturnType<typeof scriptedModel>;
  let threadId: string;
  const timings: Record<string, number> = {};
  const adminId = () => globalThis.testConfig.userId;
  const play = (scripts: IScript[]) => {
    current = scriptedModel(scripts);
  };
  const timed = async <T>(name: string, fn: () => Promise<T>) => {
    const t0 = performance.now();
    const out = await fn();
    timings[name] = Math.round(performance.now() - t0);
    return out;
  };

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
    const profile = await store.getDefaultProfile();
    await store.updateProfile(profile!.id, { model: 'mock/scripted', memoryMode: 'off' });
    vi.spyOn(app.get<IModelPort>(MODEL_PORT), 'resolve').mockImplementation(async (ref) => ({
      ref,
      modelKey: `openai@${ref}@mock`,
      model: current.model,
    }));
  }, 120_000);

  afterAll(async () => {
    console.log('agent load timings (ms):', JSON.stringify(timings));
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('writes 500 messages in batches of 100', async () => {
    const thread = await store.createThread({ title: 'Long thread', ownerId: adminId() });
    threadId = thread.id;
    await timed('append500', async () => {
      for (let b = 0; b < total; b += 100) {
        await store.appendMessages(
          threadId,
          Array.from({ length: 100 }, (_, i) => ({
            role: (b + i) % 2 ? ('assistant' as const) : ('user' as const),
            content: filler(b + i),
          }))
        );
      }
    });
    expect(timings.append500).toBeLessThan(120_000);
  }, 180_000);

  it('reads the whole thread over HTTP, in order', async () => {
    const { messages } = await timed('readAll', () => getAgentThreadMessages(threadId));
    expect(messages).toHaveLength(total);
    expect(messages.map((m) => m.seq)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(timings.readAll).toBeLessThan(15_000);
  }, 60_000);

  it('a turn sends a bounded history and summarises what it dropped', async () => {
    play([say('Here is the summary you asked for.')]);
    const t = await timed('firstTurn', async () => {
      const turn = await app.get(RunTurn).execute(adminId(), {
        threadId,
        message: { text: 'Summarise our discussion' },
      });
      await drain(turn.stream);
      return turn;
    });
    const prompt = current.prompts[0] as { role: string; content: unknown }[];
    const promptTokens = estimateTokens(JSON.stringify(prompt));
    timings.promptMessages = prompt.length;
    timings.promptTokens = promptTokens;
    expect(prompt.length).toBeLessThan(total);
    expect(promptTokens).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET * 1.2);
    expect(JSON.stringify(prompt.at(-1))).toContain('Summarise our discussion');
    expect(t.threadId).toBe(threadId);
    // the summary job covers the messages that were left out: 300+ lie before the window, folded
    // in oldest first, a batch that fits the summary model's input at a time
    const summarised = await until(
      () => store.getThread(threadId),
      (th) => (th.summaryThroughSeq ?? 0) >= 300,
      30_000
    );
    expect(summarised.summary).toBeTruthy();
  }, 120_000);

  it('turns on the long thread stay fast', async () => {
    const latencies: number[] = [];
    for (let i = 0; i < 8; i++) {
      play([say(`Reply ${i}.`)]);
      const t0 = performance.now();
      const turn = await app.get(RunTurn).execute(adminId(), {
        threadId,
        message: { text: `Question ${i}` },
      });
      await drain(turn.stream);
      latencies.push(performance.now() - t0);
    }
    timings.turnP50 = Math.round(percentile(latencies, 50));
    timings.turnP95 = Math.round(percentile(latencies, 95));
    expect(timings.turnP95).toBeLessThan(10_000);
    expect((await store.listMessages(threadId, { last: 1 }))[0].seq).toBe(total + 18);
  }, 180_000);

  it('deletes the thread with all its messages', async () => {
    await timed('deleteThread', () => store.deleteThread(threadId));
    expect(await store.listThreads({ ownerId: adminId() })).not.toContainEqual(
      expect.objectContaining({ id: threadId })
    );
    expect(timings.deleteThread).toBeLessThan(60_000);
  }, 120_000);
});

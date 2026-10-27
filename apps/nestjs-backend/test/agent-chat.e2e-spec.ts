/* eslint-disable sonarjs/no-duplicate-string */
/**
 * One turn of the agent end to end (design §10.1), with a scripted MockLanguageModelV3 in place
 * of the provider: tool order, approval pause and resume, cancel, the step cap, a crashing model,
 * the per-thread lock and the HTTP routes.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { AGENT_CHAT, getAgentThreadMessages, listAgentThreads } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { CancelRun } from '../src/features/agent/application/chat/cancel-run.usecase';
import { ResumeTurn } from '../src/features/agent/application/chat/resume-turn.usecase';
import { RunTurn } from '../src/features/agent/application/chat/run-turn.usecase';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import {
  AGENT_STORE_PORT,
  MODEL_PORT,
  RUN_STORE_PORT,
  type IAgentStorePort,
  type IModelPort,
  type IRunStorePort,
} from '../src/features/agent/domain/ports';
import { ToolkitRegistry } from '../src/features/agent/toolkits/toolkit.registry';
import type { IToolkit } from '../src/features/agent/toolkits/toolkit.types';
import type { IClsStore } from '../src/types/cls';
import { call, drain, say, scriptedModel, type IScript } from './utils/agent-script';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp, runWithTestUser } from './utils/init-app';

describe('Agent chat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: IAgentStorePort;
  let runs: IRunStorePort;
  let home: IAgentInstallationView;
  let current: ReturnType<typeof scriptedModel>;
  const executed: { name: string; input: unknown }[] = [];
  const adminId = () => globalThis.testConfig.userId;

  const probe: IToolkit = {
    id: 'data_write',
    title: 'Probe',
    tools: [
      {
        name: 'probe_read',
        description: 'Read something',
        input: z.object({ q: z.string() }),
        execute: async (input) => {
          executed.push({ name: 'probe_read', input });
          return { found: `result for ${input.q}` };
        },
      },
      {
        name: 'probe_wait',
        description: 'Something slow',
        input: z.object({ ms: z.number() }),
        execute: (input, ctx) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve({ waited: input.ms }), input.ms);
            ctx.abortSignal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            });
          }),
      },
      {
        name: 'probe_delete',
        description: 'Delete something',
        input: z.object({ id: z.string() }),
        approval: { category: 'delete_records' },
        execute: async (input) => {
          executed.push({ name: 'probe_delete', input });
          return { deleted: input.id };
        },
      },
    ],
  };

  const play = (scripts: IScript[]) => {
    current = scriptedModel(scripts);
  };
  const turn = (text: string, threadId?: string) =>
    app.get(RunTurn).execute(adminId(), { message: { text }, threadId });
  const resume = (threadId: string, approvals: { approvalId: string; approved: boolean }[]) =>
    app.get(ResumeTurn).execute(adminId(), { threadId, approvals });
  const messagesOf = (threadId: string) => store.listMessages(threadId);

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
    runs = app.get<IRunStorePort>(RUN_STORE_PORT);
    const profile = await store.getDefaultProfile();
    await store.updateProfile(profile!.id, { model: 'mock/scripted', toolkits: ['data_write'] });

    vi.spyOn(app.get<IModelPort>(MODEL_PORT), 'resolve').mockImplementation(async (ref) => ({
      ref,
      modelKey: `openai@${ref}@mock`,
      model: current.model,
    }));
    const registry = app.get(ToolkitRegistry);
    vi.spyOn(registry, 'get').mockImplementation((id) => (id === 'data_write' ? probe : undefined));
  });

  beforeEach(() => {
    executed.length = 0;
  });

  afterAll(async () => {
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('runs tools in order and saves the turn', async () => {
    play([call('probe_read', { q: 'invoices' }), say('Found the invoices.')]);
    const t = await turn('Find invoices');
    const { chunks } = await drain(t.stream);
    const types = chunks.map((c) => c.type);
    expect(types.indexOf('tool-input-available')).toBeLessThan(
      types.indexOf('tool-output-available')
    );
    expect(types.indexOf('tool-output-available')).toBeLessThan(types.indexOf('text-delta'));
    expect(executed).toEqual([{ name: 'probe_read', input: { q: 'invoices' } }]);
    // the second step saw the tool result
    expect(JSON.stringify(current.prompts[1])).toContain('result for invoices');

    const messages = await messagesOf(t.threadId);
    expect(messages.map((m) => [m.seq, m.role])).toEqual([
      [1, 'user'],
      [2, 'assistant'],
    ]);
    expect(messages[1].content).toBe('Found the invoices.');
    expect(messages[1].parts).toContain('tool-probe_read');
    const run = await runs.get(t.runId);
    expect(run).toMatchObject({ status: 'done', usage: { steps: 2, inputTokens: 20 } });
    const thread = await store.getThread(t.threadId);
    expect(thread).toMatchObject({ title: 'Find invoices', tokensIn: 20, tokensOut: 10 });
    const audit = await prisma.agentAuditLog.findMany({ where: { runId: t.runId } });
    expect(audit.map((a) => [a.tool, a.status])).toEqual([['probe_read', 'ok']]);
  });

  it('pauses for approval, then resumes the same run and reply when approved', async () => {
    play([call('probe_delete', { id: 'rec1' }, 'del-1')]);
    const t = await turn('Delete rec1');
    const { chunks } = await drain(t.stream);
    const request = chunks.find((c) => c.type === 'tool-approval-request') as {
      approvalId: string;
    };
    expect(request).toBeDefined();
    expect(executed).toEqual([]);
    const waiting = await runs.get(t.runId);
    expect(waiting).toMatchObject({
      status: 'awaiting_approval',
      pendingApproval: [{ approvalId: request.approvalId, toolName: 'probe_delete' }],
    });
    const [, reply] = await messagesOf(t.threadId);

    play([say('Deleted rec1.')]);
    const resumed = await resume(t.threadId, [{ approvalId: request.approvalId, approved: true }]);
    expect(resumed.runId).toBe(t.runId);
    await drain(resumed.stream);
    expect(executed).toEqual([{ name: 'probe_delete', input: { id: 'rec1' } }]);

    const messages = await messagesOf(t.threadId);
    expect(messages).toHaveLength(2);
    expect(messages[1].id).toBe(reply.id);
    expect(messages[1].content).toBe('Deleted rec1.');
    expect(messages[1].parts).toContain('output-available');
    expect((await runs.get(t.runId))?.status).toBe('done');
    const audit = await prisma.agentAuditLog.findMany({
      where: { runId: t.runId },
      orderBy: { createdTime: 'asc' },
    });
    expect(audit.map((a) => [a.tool, a.status])).toEqual([
      ['probe_delete', 'approved'],
      ['probe_delete', 'ok'],
    ]);
  });

  it('a denial reaches the model and the tool never runs', async () => {
    play([call('probe_delete', { id: 'rec2' }, 'del-2')]);
    const t = await turn('Delete rec2');
    const { chunks } = await drain(t.stream);
    const { approvalId } = chunks.find((c) => c.type === 'tool-approval-request') as {
      approvalId: string;
    };
    play([say('OK, I will not delete it.')]);
    await drain((await resume(t.threadId, [{ approvalId, approved: false }])).stream);
    expect(executed).toEqual([]);
    const [, reply] = await messagesOf(t.threadId);
    expect(reply.parts).toContain('output-denied');
    expect(reply.content).toBe('OK, I will not delete it.');
  });

  it('refuses wrong or partial approval answers', async () => {
    play([call('probe_delete', { id: 'rec3' }, 'del-3')]);
    const t = await turn('Delete rec3');
    await drain(t.stream);
    const error = await getError(() =>
      resume(t.threadId, [{ approvalId: 'nope', approved: true }])
    );
    expect(error?.message).toMatch(/Unknown approval/);
    // a new message instead of an answer denies the pending call
    play([say('Moving on.')]);
    await drain((await turn('Never mind', t.threadId)).stream);
    const messages = await messagesOf(t.threadId);
    expect(messages[1].parts).toContain('approval-responded');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('cancels a running turn and keeps what was said', async () => {
    play(['slow']);
    const t = await turn('Write a long essay');
    const first = await drain(t.stream, 6);
    await app.get(CancelRun).execute(adminId(), t.runId);
    await drain(first.rest!);
    expect((await runs.get(t.runId))?.status).toBe('cancelled');
    const messages = await messagesOf(t.threadId);
    expect(messages[0].content).toBe('Write a long essay');
    // the lock is released: the thread takes a new message
    play([say('Short version.')]);
    await drain((await turn('Short version please', t.threadId)).stream);
    expect((await messagesOf(t.threadId)).at(-1)?.content).toBe('Short version.');
  });

  it('a stop during a tool call leaves the thread usable', async () => {
    play([call('probe_wait', { ms: 10_000 }, 'cw')]);
    const t = await turn('Wait for it');
    const reader = t.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done || value.type === 'tool-input-available') break;
    }
    await app.get(CancelRun).execute(adminId(), t.runId);
    reader.releaseLock();
    await drain(t.stream);
    expect((await runs.get(t.runId))?.status).toBe('cancelled');
    expect((await messagesOf(t.threadId)).at(-1)?.parts).toContain('"state":"output-error"');

    play([say('Fine, moving on.')]);
    await drain((await turn('Next question', t.threadId)).stream);
    // the provider sees a result for the call that was cut off
    const prompt = current.prompts.at(-1) as { role: string; content: unknown }[];
    const results = prompt
      .filter((m) => m.role === 'tool')
      .flatMap((m) => m.content as { type: string; toolCallId: string }[]);
    expect(results).toEqual([expect.objectContaining({ type: 'tool-result', toolCallId: 'cw' })]);
    expect((await messagesOf(t.threadId)).at(-1)?.content).toBe('Fine, moving on.');
  });

  it('stops at the step cap', async () => {
    const profile = await store.getDefaultProfile();
    await store.updateProfile(profile!.id, { maxSteps: 2 });
    play([
      call('probe_read', { q: '1' }, 'c1'),
      call('probe_read', { q: '2' }, 'c2'),
      call('probe_read', { q: '3' }, 'c3'),
    ]);
    const t = await turn('Loop forever');
    await drain(t.stream);
    expect(current.prompts).toHaveLength(2);
    expect(executed).toHaveLength(2);
    expect((await runs.get(t.runId))?.status).toBe('done');
    await store.updateProfile(profile!.id, { maxSteps: 25 });
  });

  it('keeps the user message when the model crashes', async () => {
    play(['throw']);
    const t = await turn('Are you there?');
    const { chunks } = await drain(t.stream);
    expect(chunks.some((c) => c.type === 'error')).toBe(true);
    expect((await runs.get(t.runId))?.status).toBe('failed');
    const messages = await messagesOf(t.threadId);
    expect(messages.map((m) => [m.role, m.content])).toEqual([['user', 'Are you there?']]);
  });

  it('marks the run failed when the turn cannot start, and the thread stays usable', async () => {
    play([say('First answer.')]);
    const first = await turn('Hello');
    await drain(first.stream);
    const profile = (await store.getDefaultProfile())!;
    await store.updateProfile(profile.id, { model: null });
    await expect(turn('Again', first.threadId)).rejects.toThrow(/no chat model/);
    await store.updateProfile(profile.id, { model: 'mock/scripted' });

    const last = await prisma.agentRun.findFirstOrThrow({
      where: { threadRecordId: first.threadId },
      orderBy: { startedTime: 'desc' },
    });
    expect(last.status).toBe('failed');
    expect(last.error).toMatch(/no chat model/);
    expect((await runs.activeFor([first.threadId])).size).toBe(0);
    play([say('Working again.')]);
    await drain((await turn('Now?', first.threadId)).stream);
    expect((await messagesOf(first.threadId)).at(-1)?.content).toBe('Working again.');
  });

  it('allows one run per thread at a time', async () => {
    play(['slow']);
    const t = await turn('First');
    const error = await getError(() => turn('Second', t.threadId));
    expect(error?.status).toBe(409);
    await app.get(CancelRun).execute(adminId(), t.runId);
    await drain(t.stream);
  });

  it('runs the title and memory jobs after a turn', async () => {
    const profile = await store.getDefaultProfile();
    await store.updateProfile(profile!.id, { memoryMode: 'auto' });
    play([say('Noted: Dana approves invoices.')]);
    const t = await turn('Remember that Dana in finance approves every invoice');
    await drain(t.stream);
    const waitFor = async <T>(read: () => Promise<T>, ok: (v: T) => boolean) => {
      for (let i = 0; i < 50; i++) {
        const v = await read();
        if (ok(v)) return v;
        await new Promise((r) => setTimeout(r, 100));
      }
      return read();
    };
    const thread = await waitFor(
      () => store.getThread(t.threadId),
      (th) => th.title === 'Invoice approvals'
    );
    expect(thread.title).toBe('Invoice approvals');
    const memories = await waitFor(
      () => store.listMemories({ text: 'Dana' }),
      (m) => m.length > 0
    );
    expect(memories.map((m) => [m.title, m.source, m.sourceThreadId])).toEqual([
      ['Invoices are approved by Dana', 'agent_inferred', t.threadId],
    ]);
    await store.updateProfile(profile!.id, { memoryMode: 'explicit' });
  });

  describe('over HTTP', () => {
    let member: AxiosInstance;
    beforeAll(async () => {
      member = await createNewUserAxios({
        email: 'agent-chat-member@example.com',
        password: '12345678',
      });
    });

    it('streams a turn and lists the thread', async () => {
      play([say('Hello from the agent.')]);
      const { axios } = await import('@teable/openapi');
      const res = await axios.post(
        AGENT_CHAT,
        { message: { text: 'Hi over HTTP' } },
        {
          responseType: 'text',
        }
      );
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.data).toContain('"type":"data-run"');
      expect(res.data).toContain('Hello from the agent.');
      const threadId = res.headers['x-agent-thread-id'];
      const { threads } = await listAgentThreads();
      expect(threads.map((th) => th.id)).toContain(threadId);
      const { messages } = await getAgentThreadMessages(threadId);
      expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);

      const forbidden = await getError(() => member.post(AGENT_CHAT, { message: { text: 'hi' } }));
      expect(forbidden?.status).toBe(403);
      const invalid = await getError(() => axios.post(AGENT_CHAT, {}));
      expect(invalid?.status).toBe(400);
    });

    it('a client that goes away mid-reply ends the run and frees the thread', async () => {
      play(['slow']);
      const { axios } = await import('@teable/openapi');
      const controller = new AbortController();
      const res = await axios.post(
        AGENT_CHAT,
        { message: { text: 'Write slowly' } },
        { responseType: 'stream', signal: controller.signal }
      );
      const threadId = res.headers['x-agent-thread-id'];
      const runId = res.headers['x-agent-run-id'];
      // read the first bytes, then hang up
      await new Promise((resolve) => res.data.once('data', resolve));
      controller.abort();
      res.data.destroy();

      let status: string | undefined;
      for (let i = 0; i < 50 && (status = (await runs.get(runId))?.status) === 'running'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(status).toBe('cancelled');
      // the run is closed a moment before the thread lock is released
      play([say('Back again.')]);
      let next: Awaited<ReturnType<typeof turn>> | undefined;
      for (let i = 0; i < 50 && !next; i++) {
        next = await turn('Still there?', threadId).catch(async (error) => {
          if (error?.status !== 409) throw error;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return undefined;
        });
      }
      await drain(next!.stream);
      expect((await messagesOf(threadId)).at(-1)?.content).toBe('Back again.');
    });
  });
});

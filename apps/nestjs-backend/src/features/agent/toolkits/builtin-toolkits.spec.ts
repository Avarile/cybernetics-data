/* eslint-disable sonarjs/no-duplicate-string */
import type {
  IAgentProfile,
  ICredentialRef,
  IMemory,
  IMessage,
  ISkill,
  IThread,
} from '../domain/entities';
import type { IAgentStorePort } from '../domain/ports';
import type { AgentExecutionContext } from '../infrastructure/execution-context';
import { DEFAULT_AGENT_SETUP } from '../pack/agent-defaults';
import { CredentialsToolkit, setSecretPath } from './credentials/credentials.toolkit';
import { MemoryToolkit } from './memory/memory.toolkit';
import { SetupToolkit } from './setup/setup.toolkit';
import { SkillsToolkit } from './skills/skills.toolkit';
import { ThreadsToolkit } from './threads/threads.toolkit';
import { wrapTool } from './tool-wrapper';
import { ToolkitRegistry } from './toolkit.registry';
import type { IToolContext, IToolkit } from './toolkit.types';

let seq = 0;
const id = () => `rec${String(++seq).padStart(4, '0')}`;

/** Just enough of the store, in memory. */
function fakeStore() {
  const profile: IAgentProfile = {
    id: 'recProfile',
    name: 'Agent',
    isDefault: true,
    isActive: true,
    persona: 'p',
    model: 'openai/gpt-4.1',
    smallModel: null,
    knowledgeTables: [],
    searchScope: null,
    searchExclude: [],
    searchProtocol: null,
    dataBaseId: null,
    temperature: null,
    maxSteps: 25,
    maxOutputTokens: 8000,
    contextBudgetTokens: null,
    toolkits: [...DEFAULT_AGENT_SETUP.toolkits],
    approvalRequired: [...DEFAULT_AGENT_SETUP.approval_required],
    memoryMode: 'explicit',
    alwaysSkillIds: [],
  };
  const memories: IMemory[] = [];
  const skills: ISkill[] = [];
  const credentials: ICredentialRef[] = [];
  const threads: IThread[] = [];
  const messages: IMessage[] = [];
  const store = {
    getDefaultProfile: async () => profile,
    updateProfile: async (_: string, patch: Partial<IAgentProfile>) =>
      Object.assign(profile, patch),
    listMemories: async () => memories.filter((m) => m.isActive),
    getMemory: async (mid: string) => {
      const m = memories.find((x) => x.id === mid);
      if (!m) throw new Error('not found');
      return m;
    },
    createMemory: async (input: Partial<IMemory>) => {
      const m = {
        id: id(),
        content: null,
        kind: 'fact',
        scope: 'global',
        scopeRef: null,
        pinned: false,
        importance: 3,
        tags: [],
        isActive: true,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        ...input,
      } as IMemory;
      memories.push(m);
      return m;
    },
    updateMemory: async (mid: string, patch: Partial<IMemory>) =>
      Object.assign(memories.find((x) => x.id === mid)!, patch),
    listSkills: async (o?: { activeOnly?: boolean }) =>
      skills.filter((s) => o?.activeOnly === false || s.isActive),
    getSkillByName: async (name: string) => skills.find((s) => s.name === name),
    createSkill: async (input: Partial<ISkill>) => {
      const s = { id: id(), isActive: true, credentialIds: [], toolkits: [], ...input } as ISkill;
      skills.push(s);
      return s;
    },
    updateSkill: async (sid: string, patch: Partial<ISkill>) =>
      Object.assign(skills.find((s) => s.id === sid)!, patch),
    listCredentials: async () => credentials,
    getCredentialByName: async (name: string) => credentials.find((c) => c.name === name),
    createCredential: async (input: Partial<ICredentialRef>) => {
      const c = { id: id(), skillIds: [], ...input } as ICredentialRef;
      credentials.push(c);
      return c;
    },
    listThreads: async (q: { ownerId: string }) => threads.filter((t) => t.ownerId === q.ownerId),
    getThread: async (tid: string) => {
      const t = threads.find((x) => x.id === tid);
      if (!t) throw new Error('not found');
      return t;
    },
    listMessages: async (tid: string) => messages.filter((m) => m.threadId === tid),
  } as unknown as IAgentStorePort;
  return { store, profile, memories, skills, credentials, threads, messages };
}

const ctx = (profile: IAgentProfile, over: Partial<IToolContext> = {}): IToolContext => ({
  runId: 'run',
  actorUserId: 'usrAdmin',
  threadId: 'recThread',
  profile,
  ...over,
});

const run = async (kit: IToolkit, name: string, input: unknown, c: IToolContext) => {
  const tool = kit.tools.find((t) => t.name === name)!;
  return tool.execute(tool.input.parse(input), c) as Promise<Record<string, unknown>>;
};

describe('built-in toolkits', () => {
  const registry = () => new ToolkitRegistry();

  describe('memory', () => {
    it('saves, finds, updates and forgets, and dedupes by title', async () => {
      const f = fakeStore();
      const kit = new MemoryToolkit(registry(), f.store);
      const c = ctx(f.profile);
      const saved = await run(kit, 'memory_save', { title: 'Invoices go to finance@acme.test' }, c);
      expect(saved).toMatchObject({ saved: 'created' });
      expect(f.memories[0]).toMatchObject({ source: 'user_said', sourceThreadId: 'recThread' });
      const again = await run(
        kit,
        'memory_save',
        { title: 'invoices go to finance@acme.test', content: 'cc the CFO' },
        c
      );
      expect(again).toMatchObject({ saved: 'updated' });
      expect(f.memories).toHaveLength(1);

      const found = await run(kit, 'memory_search', { query: 'where do invoices go' }, c);
      expect((found.memories as { content: string }[])[0].content).toBe('cc the CFO');

      const memId = f.memories[0].id;
      await run(kit, 'memory_update', { id: memId, importance: 5, pinned: true }, c);
      expect(f.memories[0]).toMatchObject({ importance: 5, pinned: true });
      await run(kit, 'memory_forget', { id: memId }, c);
      expect(f.memories[0].isActive).toBe(false);
    });

    it('scopes memories to the admin, the base or the thread', async () => {
      const f = fakeStore();
      const kit = new MemoryToolkit(registry(), f.store);
      await run(kit, 'memory_save', { title: 'Mine', scope: 'user' }, ctx(f.profile));
      expect(f.memories[0].scopeRef).toBe('usrAdmin');
      await expect(
        run(kit, 'memory_save', { title: 'Base rule', scope: 'base' }, ctx(f.profile))
      ).rejects.toThrow(/opened from a base/);
      await run(
        kit,
        'memory_save',
        { title: 'Base rule', scope: 'base' },
        ctx(f.profile, { focus: { baseId: 'bse1' } })
      );
      expect(f.memories[1].scopeRef).toBe('bse1');
      // another admin does not see "Mine"
      const other = await run(
        kit,
        'memory_search',
        { query: 'mine' },
        ctx(f.profile, { actorUserId: 'usrB' })
      );
      expect(other.memories).toEqual([]);
    });

    it('is unavailable when memory is off', () => {
      const f = fakeStore();
      const kit = new MemoryToolkit(registry(), f.store);
      expect(kit.unavailable({ memoryMode: 'off' })).toMatch(/off/);
      expect(kit.unavailable({ memoryMode: 'explicit' })).toBeUndefined();
    });
  });

  describe('skills', () => {
    it('lists, loads with credential names, creates and bumps the version on body changes', async () => {
      const f = fakeStore();
      f.credentials.push({ id: 'recCred', name: 'github' } as ICredentialRef);
      f.skills.push({
        id: 'recS1',
        name: 'document-search',
        description: 'Search documents',
        body: 'Use search',
        invocation: 'auto',
        isActive: true,
        version: 1,
        credentialIds: ['recCred'],
        toolkits: ['knowledge'],
      } as ISkill);
      const kit = new SkillsToolkit(registry(), f.store);
      const c = ctx(f.profile);
      expect((await run(kit, 'skill_list', {}, c)).skills).toHaveLength(1);
      expect(await run(kit, 'skill_load', { name: 'document-search' }, c)).toMatchObject({
        body: 'Use search',
        credentials: ['github'],
      });
      await expect(run(kit, 'skill_load', { name: 'nope' }, c)).rejects.toThrow(/No skill/);

      await run(kit, 'skill_create', { name: 'weekly-report', description: 'd', body: 'b' }, c);
      expect(f.skills[1]).toMatchObject({ source: 'agent', version: 1 });
      await expect(
        run(kit, 'skill_create', { name: 'weekly-report', description: 'd', body: 'b' }, c)
      ).rejects.toThrow(/exists/);
      expect(() =>
        kit.tools
          .find((t) => t.name === 'skill_create')!
          .input.parse({
            name: 'Weekly Report',
            description: 'd',
            body: 'b',
          })
      ).toThrow(/kebab-case/);
      expect(() =>
        kit.tools
          .find((t) => t.name === 'skill_create')!
          .input.parse({ name: 'clear', description: 'd', body: 'b' })
      ).toThrow(/reserved/);

      await run(kit, 'skill_update', { name: 'weekly-report', description: 'new' }, c);
      expect(f.skills[1].version).toBe(1);
      await run(kit, 'skill_update', { name: 'weekly-report', body: 'b2' }, c);
      expect(f.skills[1].version).toBe(2);
    });
  });

  describe('threads', () => {
    it("finds and reads only the admin's own threads", async () => {
      const f = fakeStore();
      f.threads.push(
        {
          id: 'recT1',
          title: 'Invoice cleanup',
          summary: 'merged duplicates',
          ownerId: 'usrAdmin',
        } as IThread,
        { id: 'recT2', title: 'Invoice audit', summary: null, ownerId: 'usrOther' } as IThread
      );
      f.messages.push(
        { id: 'm1', threadId: 'recT1', role: 'user', content: 'merge them', seq: 1 } as IMessage,
        { id: 'm2', threadId: 'recT1', role: 'assistant', content: 'done', seq: 2 } as IMessage
      );
      const kit = new ThreadsToolkit(registry(), f.store);
      const c = ctx(f.profile);
      const found = await run(kit, 'thread_search', { query: 'invoice' }, c);
      expect((found.threads as { id: string }[]).map((t) => t.id)).toEqual(['recT1']);
      const read = await run(kit, 'thread_read', { id: 'recT1', from: 2 }, c);
      expect(read).toMatchObject({
        total: 2,
        messages: [{ position: 2, role: 'assistant', text: 'done' }],
      });
      await expect(run(kit, 'thread_read', { id: 'recT2' }, c)).rejects.toThrow(/not found/);
    });
  });

  describe('setup', () => {
    it('reads and updates the profile with validated values', async () => {
      const f = fakeStore();
      const kit = new SetupToolkit(registry(), f.store);
      const c = ctx(f.profile);
      expect(await run(kit, 'setup_get', {}, c)).toMatchObject({ model: 'openai/gpt-4.1' });
      await run(kit, 'setup_update', { smallModel: 'openai/gpt-4.1-mini', memoryMode: 'auto' }, c);
      expect(f.profile).toMatchObject({ smallModel: 'openai/gpt-4.1-mini', memoryMode: 'auto' });
      const input = kit.tools.find((t) => t.name === 'setup_update')!.input;
      expect(() => input.parse({ model: 'gpt-4.1' })).toThrow(/providerId\/model/);
      expect(() => input.parse({ toolkits: ['root_shell'] })).toThrow();
      expect(() => input.parse({})).toThrow(/nothing to change/);
    });
  });

  describe('credentials', () => {
    it('lists metadata and requests a missing credential with a set-secret link', async () => {
      const f = fakeStore();
      const kit = new CredentialsToolkit(registry(), f.store);
      const c = ctx(f.profile);
      const out = await run(
        kit,
        'credential_request',
        { name: 'github', why: 'read issues', hosts: ['api.github.com'], kind: 'bearer' },
        c
      );
      expect(out).toMatchObject({
        name: 'github',
        status: 'missing',
        created: true,
        setSecretUrl: setSecretPath(f.credentials[0].id),
      });
      expect(out.tellTheAdmin).toMatch(/Do not ask for it in the chat/);
      expect(f.credentials[0]).toMatchObject({
        allowedHosts: ['api.github.com'],
        allowedMethods: ['GET'],
      });
      // asking twice does not duplicate
      await run(
        kit,
        'credential_request',
        { name: 'github', why: 'x', hosts: ['api.github.com'], kind: 'bearer' },
        c
      );
      expect(f.credentials).toHaveLength(1);
      const listed = await run(kit, 'credential_list', {}, c);
      expect(JSON.stringify(listed)).not.toMatch(/secret"/);
      // no tool takes a secret value
      for (const tool of kit.tools) {
        const keys = Object.keys((tool.input as unknown as { shape: object }).shape);
        expect(keys.filter((k) => /secret|value|token|password|key/i.test(k))).toEqual([]);
      }
    });
  });

  describe('approvals with the default setup', () => {
    it('setup and skill writes wait for the admin; memory and reads do not', () => {
      const f = fakeStore();
      const deps = {
        audit: { append: vi.fn() },
        execution: {} as AgentExecutionContext,
        maxResultChars: 1000,
      };
      const kits: IToolkit[] = [
        new MemoryToolkit(registry(), f.store),
        new SkillsToolkit(registry(), f.store),
        new ThreadsToolkit(registry(), f.store),
        new SetupToolkit(registry(), f.store),
        new CredentialsToolkit(registry(), f.store),
      ];
      const approval = Object.fromEntries(
        kits
          .flatMap((k) => k.tools)
          .map((t) => [t.name, wrapTool(t, ctx(f.profile), deps).needsApproval])
      );
      expect(approval).toEqual({
        memory_search: false,
        memory_save: false,
        memory_update: false,
        memory_forget: false,
        skill_list: false,
        skill_load: false,
        skill_create: true,
        skill_update: true,
        thread_search: false,
        thread_read: false,
        setup_get: false,
        setup_update: true,
        credential_list: false,
        credential_request: false,
      });
    });

    it('all register into one registry without name clashes', () => {
      const f = fakeStore();
      const reg = registry();
      for (const toolkitClass of [
        MemoryToolkit,
        SkillsToolkit,
        ThreadsToolkit,
        SetupToolkit,
        CredentialsToolkit,
      ]) {
        new toolkitClass(reg, f.store).onModuleInit();
      }
      expect(reg.list().map((k) => k.id)).toEqual([
        'memory',
        'skills',
        'threads',
        'setup',
        'credentials',
      ]);
    });
  });
});

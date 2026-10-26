import { AGENT_ROBOT_ID } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import { RecordOpenApiService } from '../../../record/open-api/record-open-api.service';
import { RecordService } from '../../../record/record.service';
import type {
  IAgentProfile,
  ICredentialRef,
  IMemory,
  IMessage,
  IPatch,
  ISkill,
  IThread,
} from '../../domain/entities';
import {
  AGENT_LAYOUT_PORT,
  type IAgentLayoutPort,
  type IAgentStorePort,
  type IMemoryQuery,
  type IMessageInput,
  type IThreadQuery,
} from '../../domain/ports';
import { AgentExecutionContext } from '../execution-context';
import {
  credentialSpec,
  memorySpec,
  messageSpec,
  profileSpec,
  skillSpec,
  threadSpec,
} from './entity-specs';
import type { IRepoDeps } from './table-repo';
import { TableRepo } from './table-repo';

/** `agent_messages.parts` is capped (design §7.2); bigger payloads are replaced by a marker. */
export const MAX_PARTS_BYTES = 64 * 1024;
const summaryLength = 100;

const cappedParts = (parts: string | null | undefined) => {
  if (!parts) return parts;
  if (Buffer.byteLength(parts, 'utf8') <= MAX_PARTS_BYTES) return parts;
  return JSON.stringify([{ type: 'text', text: '[parts omitted: larger than 64 KB]' }]);
};

export const messageSummary = (input: IMessageInput) => {
  const text = (input.content ?? '').replace(/\s+/g, ' ').trim();
  return (text || input.role).slice(0, summaryLength);
};

/** AgentStorePort over the Agent base (design §5.3, §7.2). */
@Injectable()
export class AgentTableStore implements IAgentStorePort {
  private readonly profiles: TableRepo<IAgentProfile>;
  private readonly memories: TableRepo<IMemory>;
  private readonly threads: TableRepo<IThread>;
  private readonly messages: TableRepo<IMessage>;
  private readonly skills: TableRepo<ISkill>;
  private readonly credentials: TableRepo<ICredentialRef>;

  constructor(
    @Inject(AGENT_LAYOUT_PORT) layoutPort: IAgentLayoutPort,
    records: RecordService,
    recordsApi: RecordOpenApiService,
    execution: AgentExecutionContext
  ) {
    const deps: IRepoDeps = {
      layout: () => layoutPort.layout(),
      records,
      recordsApi,
      scoped: (fn) =>
        execution.current()
          ? fn()
          : execution.run({ runId: 'store', actorUserId: AGENT_ROBOT_ID }, fn),
    };
    this.profiles = new TableRepo(profileSpec, deps);
    this.memories = new TableRepo(memorySpec, deps);
    this.threads = new TableRepo(threadSpec, deps);
    this.messages = new TableRepo(messageSpec, deps);
    this.skills = new TableRepo(skillSpec, deps);
    this.credentials = new TableRepo(credentialSpec, deps);
  }

  // ── setup ────────────────────────────────────────────────────────────────

  listProfiles() {
    return this.profiles.find({ orderBy: [['id', 'asc']] });
  }

  async getDefaultProfile() {
    const active = (await this.listProfiles()).filter((p) => p.isActive);
    return active.find((p) => p.isDefault) ?? active[0];
  }

  updateProfile(id: string, patch: IPatch<IAgentProfile>) {
    return this.profiles.update(id, patch);
  }

  // ── memory ───────────────────────────────────────────────────────────────

  listMemories(query: IMemoryQuery = {}) {
    return this.memories.find({
      where: (f) =>
        [
          ...(query.activeOnly === false
            ? []
            : [{ fieldId: f('is_active'), operator: 'is', value: true }]),
          ...(query.pinned === undefined
            ? []
            : [{ fieldId: f('pinned'), operator: 'is', value: query.pinned }]),
          ...(query.scope ? [{ fieldId: f('scope'), operator: 'is', value: query.scope }] : []),
          ...(query.scopeRef
            ? [{ fieldId: f('scope_ref'), operator: 'is', value: query.scopeRef }]
            : []),
          ...(query.text
            ? [
                {
                  conjunction: 'or' as const,
                  filterSet: [
                    { fieldId: f('title'), operator: 'contains', value: query.text },
                    { fieldId: f('content'), operator: 'contains', value: query.text },
                  ],
                },
              ]
            : []),
        ] as never,
      orderBy: [['created_at', 'desc']],
      take: query.take ?? 50,
    });
  }

  getMemory(id: string) {
    return this.memories.get(id);
  }

  async createMemory(input: IPatch<IMemory> & { title: string }) {
    const [memory] = await this.memories.create([{ isActive: true, scope: 'global', ...input }]);
    return memory;
  }

  updateMemory(id: string, patch: IPatch<IMemory>) {
    return this.memories.update(id, patch);
  }

  // ── threads ──────────────────────────────────────────────────────────────

  async createThread(input: IPatch<IThread> & { title: string; ownerId: string }) {
    const [thread] = await this.threads.create([{ status: 'active', messageCount: 0, ...input }]);
    return thread;
  }

  getThread(id: string) {
    return this.threads.get(id);
  }

  listThreads(query: IThreadQuery) {
    return this.threads.find({
      where: (f) =>
        [
          { fieldId: f('owner'), operator: 'is', value: query.ownerId },
          ...(query.status ? [{ fieldId: f('status'), operator: 'is', value: query.status }] : []),
        ] as never,
      orderBy: [
        ['last_message_at', 'desc'],
        ['created_at', 'desc'],
      ],
      take: query.take ?? 50,
      skip: query.skip,
    });
  }

  updateThread(id: string, patch: IPatch<IThread>) {
    return this.threads.update(id, patch);
  }

  async deleteThread(id: string) {
    const messages = await this.listMessages(id);
    await this.messages.delete(messages.map((m) => m.id));
    await this.threads.delete([id]);
  }

  // ── messages ─────────────────────────────────────────────────────────────

  private threadMessages(threadId: string, order: 'asc' | 'desc', take?: number, after?: number) {
    return this.messages.find({
      where: (f) =>
        [
          { fieldId: f('thread'), operator: 'is', value: threadId },
          ...(after ? [{ fieldId: f('seq'), operator: 'isGreater', value: after }] : []),
        ] as never,
      orderBy: [['seq', order]],
      take,
    });
  }

  async appendMessages(threadId: string, inputs: IMessageInput[]) {
    if (!inputs.length) return [];
    const [last] = await this.threadMessages(threadId, 'desc', 1);
    const start = (last?.seq ?? 0) + 1;
    const created = await this.messages.create(
      inputs.map((input, i) => ({
        ...input,
        parts: cappedParts(input.parts),
        threadId,
        seq: start + i,
        summary: messageSummary(input),
      }))
    );
    const thread = await this.threads.get(threadId);
    await this.threads.update(threadId, {
      messageCount: (thread.messageCount ?? 0) + created.length,
      lastMessageAt: new Date().toISOString(),
    });
    return created.sort((a, b) => a.seq - b.seq);
  }

  updateMessage(id: string, patch: Omit<IPatch<IMessage>, 'threadId' | 'seq'>) {
    return this.messages.update(id, {
      ...patch,
      ...(patch.parts !== undefined ? { parts: cappedParts(patch.parts) } : {}),
      ...(patch.content !== undefined && patch.summary === undefined
        ? { summary: (patch.content ?? '').replace(/\s+/g, ' ').trim().slice(0, summaryLength) }
        : {}),
    });
  }

  async listMessages(
    threadId: string,
    options: { last?: number; after?: number; first?: number } = {}
  ) {
    if (options.after !== undefined || options.first !== undefined) {
      return this.threadMessages(threadId, 'asc', options.first, options.after);
    }
    if (options.last === undefined) return this.threadMessages(threadId, 'asc');
    const newest = await this.threadMessages(threadId, 'desc', options.last);
    return newest.reverse();
  }

  // ── skills ───────────────────────────────────────────────────────────────

  listSkills(options: { activeOnly?: boolean } = {}) {
    return this.skills.find({
      where: (f) =>
        (options.activeOnly === false
          ? []
          : [{ fieldId: f('is_active'), operator: 'is', value: true }]) as never,
      orderBy: [['name', 'asc']],
    });
  }

  async getSkillByName(name: string) {
    const [skill] = await this.skills.find({
      where: (f) => [{ fieldId: f('name'), operator: 'is', value: name }] as never,
      take: 1,
    });
    return skill;
  }

  async createSkill(input: IPatch<ISkill> & { name: string }) {
    const [skill] = await this.skills.create([
      { isActive: true, source: 'agent', version: 1, invocation: 'auto', ...input },
    ]);
    return skill;
  }

  updateSkill(id: string, patch: IPatch<ISkill>) {
    return this.skills.update(id, patch);
  }

  // ── credentials ──────────────────────────────────────────────────────────

  listCredentials() {
    return this.credentials.find({ orderBy: [['name', 'asc']] });
  }

  async getCredentialByName(name: string) {
    const [credential] = await this.credentials.find({
      where: (f) => [{ fieldId: f('name'), operator: 'is', value: name }] as never,
      take: 1,
    });
    return credential;
  }

  async createCredential(input: IPatch<ICredentialRef> & { name: string }) {
    const [credential] = await this.credentials.create([
      { status: 'missing', allowedMethods: ['GET'], ...input },
    ]);
    return credential;
  }

  updateCredential(id: string, patch: IPatch<ICredentialRef>) {
    return this.credentials.update(id, patch);
  }
}

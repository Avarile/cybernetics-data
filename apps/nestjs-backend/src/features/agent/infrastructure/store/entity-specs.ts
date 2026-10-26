import type {
  IAgentProfile,
  ICredentialAuthKind,
  ICredentialRef,
  ICredentialStatus,
  IMemory,
  IMemoryKind,
  IMemoryMode,
  IMemoryScope,
  IMemorySource,
  IMessage,
  IMessageRole,
  ISkill,
  ISkillInvocation,
  ISkillSource,
  IThread,
  IThreadStatus,
} from '../../domain/entities';
import { AGENT_TABLES } from '../../pack/agent-pack';
import type { ICodec } from './codecs';
import { bool, choice, date, lines, num, ref, refs, strings, text, title, user } from './codecs';

/** entity key -> [pack field key, codec]. `id` is the record id and is not listed. */
export type IFieldSpecs<E> = { [K in Exclude<keyof E, 'id'>]: [string, ICodec<E[K]>] };

export interface IEntitySpec<E extends { id: string }> {
  table: string;
  fields: IFieldSpecs<E>;
}

export const profileSpec: IEntitySpec<IAgentProfile> = {
  table: AGENT_TABLES.setup,
  fields: {
    name: ['name', title],
    isDefault: ['is_default', bool],
    isActive: ['is_active', bool],
    persona: ['persona', text],
    model: ['model', text],
    smallModel: ['small_model', text],
    embeddingModel: ['embedding_model', text],
    rerankModel: ['rerank_model', text],
    knowledgeTables: ['knowledge_tables', lines],
    temperature: ['temperature', num],
    maxSteps: ['max_steps', num],
    maxOutputTokens: ['max_output_tokens', num],
    contextBudgetTokens: ['context_budget_tokens', num],
    toolkits: ['toolkits', strings],
    approvalRequired: ['approval_required', strings],
    memoryMode: ['memory_mode', choice<IMemoryMode>()],
    alwaysSkillIds: ['always_skills', refs],
  },
};

export const memorySpec: IEntitySpec<IMemory> = {
  table: AGENT_TABLES.memory,
  fields: {
    title: ['title', title],
    content: ['content', text],
    kind: ['kind', choice<IMemoryKind>()],
    scope: ['scope', choice<IMemoryScope>()],
    scopeRef: ['scope_ref', text],
    pinned: ['pinned', bool],
    importance: ['importance', num],
    source: ['source', choice<IMemorySource>()],
    sourceThreadId: ['source_thread', ref],
    tags: ['tags', strings],
    useCount: ['use_count', num],
    lastUsedAt: ['last_used_at', date],
    expiresAt: ['expires_at', date],
    embeddedAt: ['embedded_at', date],
    isActive: ['is_active', bool],
    createdAt: ['created_at', date],
  },
};

export const threadSpec: IEntitySpec<IThread> = {
  table: AGENT_TABLES.threads,
  fields: {
    title: ['title', title],
    ownerId: ['owner', user],
    profileId: ['profile', ref],
    status: ['status', choice<IThreadStatus>()],
    focusBaseId: ['focus_base_id', text],
    focusTableId: ['focus_table_id', text],
    summary: ['summary', text],
    messageCount: ['message_count', num],
    tokensIn: ['tokens_in', num],
    tokensOut: ['tokens_out', num],
    costUsd: ['cost_usd', num],
    lastMessageAt: ['last_message_at', date],
    createdAt: ['created_at', date],
  },
};

export const messageSpec: IEntitySpec<IMessage> = {
  table: AGENT_TABLES.messages,
  fields: {
    threadId: ['thread', ref],
    seq: ['seq', { read: (v) => (typeof v === 'number' ? v : 0), write: (v) => v }],
    role: ['role', choice<IMessageRole>()],
    summary: ['summary', title],
    content: ['content', text],
    parts: ['parts', text],
    model: ['model', text],
    tokensIn: ['tokens_in', num],
    tokensOut: ['tokens_out', num],
    error: ['error', text],
    createdAt: ['created_at', date],
  },
};

export const skillSpec: IEntitySpec<ISkill> = {
  table: AGENT_TABLES.skills,
  fields: {
    name: ['name', title],
    description: ['description', text],
    body: ['body', text],
    invocation: ['invocation', choice<ISkillInvocation>()],
    toolkits: ['toolkits', strings],
    credentialIds: ['credentials', refs],
    category: ['category', text],
    source: ['source', choice<ISkillSource>()],
    version: ['version', num],
    isActive: ['is_active', bool],
  },
};

export const credentialSpec: IEntitySpec<ICredentialRef> = {
  table: AGENT_TABLES.credentials,
  fields: {
    name: ['name', title],
    description: ['description', text],
    authKind: ['auth_kind', choice<ICredentialAuthKind>()],
    headerName: ['header_name', text],
    queryParam: ['query_param', text],
    allowedHosts: ['allowed_hosts', lines],
    allowedMethods: ['allowed_methods', strings],
    status: ['status', choice<ICredentialStatus>()],
    preview: ['preview', text],
    expiresAt: ['expires_at', date],
    lastUsedAt: ['last_used_at', date],
    skillIds: ['skills', refs],
  },
};

/** Computed fields are read, never written. */
const readOnlyFields = new Set(['created_at', 'updated_at', 'id']);

/** A record's cells (by field id) -> the entity. A field missing from the layout reads as empty. */
export function readEntity<E extends { id: string }>(
  spec: IEntitySpec<E>,
  fieldIds: Record<string, string>,
  record: { id: string; fields: Record<string, unknown> }
): E {
  const entity: Record<string, unknown> = { id: record.id };
  for (const [key, [packKey, codec]] of Object.entries(spec.fields) as [
    string,
    [string, ICodec<unknown>],
  ][]) {
    const fieldId = fieldIds[packKey];
    entity[key] = codec.read(fieldId ? record.fields[fieldId] : undefined);
  }
  return entity as E;
}

/** An entity patch -> cells by field id. Unknown keys and computed fields are dropped. */
export function writeEntity<E extends { id: string }>(
  spec: IEntitySpec<E>,
  fieldIds: Record<string, string>,
  patch: Partial<Omit<E, 'id'>>
): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const entry = (spec.fields as Record<string, [string, ICodec<unknown>] | undefined>)[key];
    if (!entry || value === undefined || readOnlyFields.has(entry[0])) continue;
    const fieldId = fieldIds[entry[0]];
    if (!fieldId) throw new Error(`Agent table ${spec.table} has no field ${entry[0]}`);
    cells[fieldId] = entry[1].write(value);
  }
  return cells;
}

/** Field ids to fetch for an entity. */
export const projectionOf = <E extends { id: string }>(
  spec: IEntitySpec<E>,
  fieldIds: Record<string, string>
) =>
  Object.values(spec.fields as Record<string, [string, unknown]>)
    .map(([packKey]) => fieldIds[packKey])
    .filter((id): id is string => !!id);

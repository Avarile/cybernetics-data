/**
 * What the agent keeps in its tables (design §7.2), as plain objects with camelCase keys. The
 * store maps them to and from the Agent base; nothing here knows about tables or field ids.
 */

export type IMemoryMode = 'off' | 'explicit' | 'auto';
export type IMemoryKind = 'fact' | 'preference' | 'instruction' | 'entity' | 'episode';
export type IMemoryScope = 'global' | 'user' | 'base' | 'thread';
export type IMemorySource = 'user_said' | 'agent_inferred' | 'admin' | 'imported';
export type IThreadStatus = 'active' | 'archived';
export type IMessageRole = 'user' | 'assistant' | 'tool' | 'system';
export type ISkillInvocation = 'auto' | 'manual' | 'always';
export type ISkillSource = 'builtin' | 'admin' | 'agent' | 'imported';
export type ICredentialAuthKind =
  | 'bearer'
  | 'header'
  | 'query_param'
  | 'basic'
  | 'oauth2_client_credentials';
export type ICredentialStatus = 'missing' | 'set' | 'invalid' | 'expired';
export type ISearchScope = 'all' | 'knowledge';

export interface IAgentProfile {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  persona: string | null;
  model: string | null;
  smallModel: string | null;
  /** Tables synced into kb_records; empty means detect them (design §11.3). */
  knowledgeTables: string[];
  /** What search covers; null means all (current-design §4.2). */
  searchScope: ISearchScope | null;
  /** Base or table ids never indexed. */
  searchExclude: string[];
  temperature: number | null;
  maxSteps: number | null;
  maxOutputTokens: number | null;
  contextBudgetTokens: number | null;
  toolkits: string[];
  approvalRequired: string[];
  memoryMode: IMemoryMode | null;
  alwaysSkillIds: string[];
}

export interface IMemory {
  id: string;
  title: string;
  content: string | null;
  kind: IMemoryKind | null;
  scope: IMemoryScope | null;
  scopeRef: string | null;
  pinned: boolean;
  importance: number | null;
  source: IMemorySource | null;
  sourceThreadId: string | null;
  tags: string[];
  useCount: number | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  embeddedAt: string | null;
  isActive: boolean;
  createdAt: string | null;
}

export interface IThread {
  id: string;
  title: string;
  ownerId: string | null;
  profileId: string | null;
  status: IThreadStatus | null;
  focusBaseId: string | null;
  focusTableId: string | null;
  summary: string | null;
  /** The summary covers messages up to this seq. */
  summaryThroughSeq: number | null;
  messageCount: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  lastMessageAt: string | null;
  createdAt: string | null;
}

export interface IMessage {
  id: string;
  threadId: string | null;
  seq: number;
  role: IMessageRole | null;
  summary: string;
  content: string | null;
  /** AI SDK `UIMessage.parts` as JSON. */
  parts: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: string | null;
  createdAt: string | null;
}

export interface ISkill {
  id: string;
  name: string;
  description: string | null;
  body: string | null;
  invocation: ISkillInvocation | null;
  toolkits: string[];
  credentialIds: string[];
  category: string | null;
  source: ISkillSource | null;
  version: number | null;
  isActive: boolean;
}

export interface ICredentialRef {
  id: string;
  name: string;
  description: string | null;
  authKind: ICredentialAuthKind | null;
  headerName: string | null;
  queryParam: string | null;
  allowedHosts: string[];
  allowedMethods: string[];
  status: ICredentialStatus | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  skillIds: string[];
}

/** Writable shape: everything but the id, all optional. */
export type IPatch<T extends { id: string }> = Partial<Omit<T, 'id'>>;

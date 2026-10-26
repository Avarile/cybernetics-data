/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IAgentProfile,
  ICredentialRef,
  IMemory,
  IMemoryScope,
  IMessage,
  IPatch,
  ISkill,
  IThread,
  IThreadStatus,
} from '../entities';

export interface IMemoryQuery {
  /** Default true: forgotten memories (is_active off) are left out. */
  activeOnly?: boolean;
  pinned?: boolean;
  scope?: IMemoryScope;
  scopeRef?: string;
  /** Matches title or content. */
  text?: string;
  take?: number;
}

export interface IThreadQuery {
  ownerId: string;
  status?: IThreadStatus;
  take?: number;
  skip?: number;
}

export type IMessageInput = Omit<IPatch<IMessage>, 'threadId' | 'seq' | 'summary' | 'createdAt'> & {
  role: NonNullable<IMessage['role']>;
};

/**
 * The agent's own data (design §5.3). The v1 adapter keeps it in the Agent base, so admins can
 * read and edit everything in the normal table UI.
 */
export interface IAgentStorePort {
  listProfiles(): Promise<IAgentProfile[]>;
  /** The active default profile, else the first active one. */
  getDefaultProfile(): Promise<IAgentProfile | undefined>;
  updateProfile(id: string, patch: IPatch<IAgentProfile>): Promise<IAgentProfile>;

  listMemories(query?: IMemoryQuery): Promise<IMemory[]>;
  getMemory(id: string): Promise<IMemory>;
  createMemory(input: IPatch<IMemory> & { title: string }): Promise<IMemory>;
  updateMemory(id: string, patch: IPatch<IMemory>): Promise<IMemory>;

  createThread(input: IPatch<IThread> & { title: string; ownerId: string }): Promise<IThread>;
  getThread(id: string): Promise<IThread>;
  /** Newest first. */
  listThreads(query: IThreadQuery): Promise<IThread[]>;
  updateThread(id: string, patch: IPatch<IThread>): Promise<IThread>;
  deleteThread(id: string): Promise<void>;

  /** Appends after the thread's last message; seq and summary are filled in. */
  appendMessages(threadId: string, messages: IMessageInput[]): Promise<IMessage[]>;
  /** In seq order; `last` keeps only the newest N. */
  listMessages(threadId: string, options?: { last?: number }): Promise<IMessage[]>;
  updateMessage(id: string, patch: Omit<IPatch<IMessage>, 'threadId' | 'seq'>): Promise<IMessage>;

  listSkills(options?: { activeOnly?: boolean }): Promise<ISkill[]>;
  getSkillByName(name: string): Promise<ISkill | undefined>;
  createSkill(input: IPatch<ISkill> & { name: string }): Promise<ISkill>;
  updateSkill(id: string, patch: IPatch<ISkill>): Promise<ISkill>;

  listCredentials(): Promise<ICredentialRef[]>;
  getCredentialByName(name: string): Promise<ICredentialRef | undefined>;
  updateCredential(id: string, patch: IPatch<ICredentialRef>): Promise<ICredentialRef>;
}

export const AGENT_STORE_PORT = Symbol('AGENT_STORE_PORT');

/** Where the agent's tables and fields are: pack key -> id (kept by EnsureInstallation). */
export interface IAgentLayout {
  tableMap: Record<string, string>;
  fieldMap: Record<string, Record<string, string>>;
}

export interface IAgentLayoutPort {
  /** The current layout of a healthy installation; throws when the agent cannot run. */
  layout(): Promise<IAgentLayout>;
}

export const AGENT_LAYOUT_PORT = Symbol('AGENT_LAYOUT_PORT');

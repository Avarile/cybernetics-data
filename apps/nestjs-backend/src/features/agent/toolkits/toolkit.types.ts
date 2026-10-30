import type { z } from 'zod';
import type { IAgentProfile } from '../domain/entities';
import type { IApprovalRule } from '../domain/policies/approval-policy';
import type { ISearchEventSink } from '../domain/ports';

/** The toolkits `agent_setup.toolkits` can switch on (design §8). */
export const TOOLKIT_IDS = [
  'memory',
  'skills',
  'threads',
  'setup',
  'credentials',
  'data_read',
  'data_write',
  'schema',
  'sql_read',
  'knowledge',
  'http',
] as const;
/** Toolkits every profile gets, not chosen in agent_setup: the answer protocol rests on them. */
export const ALWAYS_TOOLKIT_IDS = ['investigate'] as const;
export type IToolkitId = (typeof TOOLKIT_IDS)[number] | (typeof ALWAYS_TOOLKIT_IDS)[number];

/** What a tool knows about the turn it runs in. */
export interface IToolContext {
  runId: string;
  /** The admin the agent works for. */
  actorUserId: string;
  threadId?: string;
  profile: IAgentProfile;
  /** The base/table the chat was opened from: a hint, never a limit. */
  focus?: { baseId?: string; tableId?: string; viewId?: string; recordIds?: string[] };
  abortSignal?: AbortSignal;
  /** Where search progress goes: the turn's UI stream (cockpit design §7.2). */
  events?: ISearchEventSink;
}

// `any`: toolkits hold tools with different inputs side by side
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IAgentToolDef<I = any, O = unknown> {
  /** snake_case, unique across toolkits. */
  name: string;
  description: string;
  input: z.ZodType<I>;
  approval?: IApprovalRule<I>;
  /**
   * The output carries text from records, files or the web: it is handed to the model wrapped
   * as untrusted data (design §9.3).
   */
  untrusted?: boolean;
  /** Top-level output keys kept whole when the result is cut to the budget. */
  keepOnCap?: readonly string[];
  execute(input: I, ctx: IToolContext): Promise<O>;
}

export interface IToolkit {
  id: IToolkitId;
  title: string;
  tools: IAgentToolDef[];
  /** Why the toolkit cannot run with this profile (e.g. memory switched off), or undefined. */
  unavailable?(profile: IAgentProfile): string | undefined;
}

/** Identity helper so a tool's `execute` gets its input type from the zod schema. */
export const defineTool = <I, O>(def: IAgentToolDef<I, O>): IAgentToolDef<I, O> => def;

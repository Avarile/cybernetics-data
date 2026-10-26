/* eslint-disable @typescript-eslint/naming-convention */
export type IRunStatus = 'running' | 'awaiting_approval' | 'done' | 'failed' | 'cancelled';

export interface IPendingApproval {
  approvalId: string;
  toolName: string;
  input: unknown;
}

export interface IRunUsage {
  inputTokens: number;
  outputTokens: number;
  steps: number;
}

export interface IAgentRun {
  id: string;
  threadId: string;
  actorUserId: string;
  status: IRunStatus;
  model: string | null;
  pendingApproval: IPendingApproval[] | null;
  usage: IRunUsage | null;
  error: string | null;
}

/** One turn of the agent (design §7.3 `agent_run`), from the user message to done/failed. */
export interface IRunStorePort {
  create(input: {
    threadId: string;
    actorUserId: string;
    model: string | null;
  }): Promise<IAgentRun>;
  get(id: string): Promise<IAgentRun | undefined>;
  update(
    id: string,
    patch: Partial<Pick<IAgentRun, 'status' | 'pendingApproval' | 'usage' | 'error'>>
  ): Promise<void>;
  /** The run of a thread that is still running or waiting for approval. */
  activeFor(threadIds: string[]): Promise<Map<string, IAgentRun>>;
}

export const RUN_STORE_PORT = Symbol('AGENT_RUN_STORE_PORT');

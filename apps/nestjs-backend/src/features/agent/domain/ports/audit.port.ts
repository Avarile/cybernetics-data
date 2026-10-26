/* eslint-disable @typescript-eslint/naming-convention */
export type IAuditStatus = 'ok' | 'error' | 'denied' | 'approved' | 'rejected';

export interface IAuditEntry {
  runId: string;
  actorUserId: string;
  /** Tool name, or a lifecycle event such as `installation.membership`. */
  tool: string;
  /** Redacted, size-capped arguments. */
  args: unknown;
  resultSummary?: string;
  status: IAuditStatus;
  durationMs: number;
}

/** Append-only record of what the agent did and for whom. No agent tool can reach it. */
export interface IAuditPort {
  append(entry: IAuditEntry): Promise<void>;
}

export const AUDIT_PORT = Symbol('AGENT_AUDIT_PORT');

import type { UIMessage } from 'ai';
import type { IPendingApproval } from '../domain/ports';

/**
 * Helpers over AI SDK UI message parts. Tool parts are `tool-<name>` (or `dynamic-tool`) with a
 * `state`; an approval is `{ id, approved?, reason? }` on the part (AI SDK 6).
 */
type IPart = UIMessage['parts'][number];
type IToolPart = IPart & {
  type: string;
  toolCallId: string;
  toolName?: string;
  state: string;
  input?: unknown;
  approval?: { id: string; approved?: boolean; reason?: string };
};

export const isToolPart = (part: IPart): part is IToolPart =>
  part.type.startsWith('tool-') || part.type === 'dynamic-tool';

export const toolNameOf = (part: IToolPart) =>
  part.type === 'dynamic-tool' ? part.toolName ?? '' : part.type.slice('tool-'.length);

/** The visible text of a message. */
export const textOf = (parts: UIMessage['parts']) =>
  parts
    .filter((p): p is Extract<IPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim();

/** Tool calls in the message that wait for the admin. */
export const pendingApprovalsOf = (parts: UIMessage['parts']): IPendingApproval[] =>
  parts
    .filter(isToolPart)
    .filter((p) => p.state === 'approval-requested' && p.approval?.id)
    .map((p) => ({ approvalId: p.approval!.id, toolName: toolNameOf(p), input: p.input }));

/**
 * Write the admin's answers into the waiting tool parts. Every pending approval must be answered,
 * and only those (the AI SDK resumes a message only when all of them are).
 */
export function applyApprovals(
  parts: UIMessage['parts'],
  answers: { approvalId: string; approved: boolean; reason?: string }[]
): { parts: UIMessage['parts']; missing: string[]; unknown: string[] } {
  const pending = new Set(pendingApprovalsOf(parts).map((p) => p.approvalId));
  const byId = new Map(answers.map((a) => [a.approvalId, a]));
  const unknown = answers.map((a) => a.approvalId).filter((id) => !pending.has(id));
  const missing = [...pending].filter((id) => !byId.has(id));
  const next = parts.map((part) => {
    if (!isToolPart(part) || part.state !== 'approval-requested' || !part.approval) return part;
    const answer = byId.get(part.approval.id);
    if (!answer) return part;
    return {
      ...part,
      state: 'approval-responded',
      approval: { id: part.approval.id, approved: answer.approved, reason: answer.reason },
    } as IPart;
  });
  return { parts: next, missing, unknown };
}

/** A new message while approvals wait: they are denied, so the history stays well-formed. */
export function denyPending(parts: UIMessage['parts'], reason: string) {
  const answers = pendingApprovalsOf(parts).map((p) => ({
    approvalId: p.approvalId,
    approved: false,
    reason,
  }));
  return applyApprovals(parts, answers).parts;
}

/**
 * Tool parts of tools the agent no longer has (a toolkit was switched off) become a short text,
 * because the AI SDK refuses history with tools it does not know.
 */
export function dropUnknownTools(messages: UIMessage[], toolNames: Set<string>): UIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((part) => {
      if (!isToolPart(part) || toolNames.has(toolNameOf(part))) return part;
      return {
        type: 'text',
        text: `[earlier tool call ${toolNameOf(part)}: ${part.state}]`,
      } as IPart;
    }),
  }));
}

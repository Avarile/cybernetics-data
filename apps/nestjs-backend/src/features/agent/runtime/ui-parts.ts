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

/** The error a tool call gets when a stop cut it off before its result. */
export const INTERRUPTED_TOOL_ERROR = 'Stopped before it finished; it may or may not have run.';
const unfinishedStates = new Set(['input-streaming', 'input-available']);

/**
 * Tool calls a stop cut off (no result yet) get an error result: providers refuse a history with
 * a tool call that has no result, which would break every later turn of the thread.
 */
export const settleInterruptedTools = (parts: UIMessage['parts']): UIMessage['parts'] =>
  parts.map((part) =>
    isToolPart(part) && unfinishedStates.has(part.state)
      ? ({ ...part, state: 'output-error', errorText: INTERRUPTED_TOOL_ERROR } as IPart)
      : part
  );

/** The option the admin picked (a `data-choice` part), as words the model reads. */
export function choiceText(data: unknown): string {
  const d = (data ?? {}) as {
    label?: string;
    recordRef?: { table?: string; recordId?: string };
  };
  const record = d.recordRef?.recordId
    ? `: ${d.recordRef.table ?? 'record'} ${d.recordRef.recordId}`
    : '';
  return `[The admin picked the option "${d.label ?? ''}"${record}]`;
}

/**
 * The history as the model gets it: tool parts of tools the agent no longer has (a toolkit was
 * switched off) become a short text, because the AI SDK refuses history with tools it does not
 * know; tool calls a stop cut off get their error result; the admin's picked option becomes text.
 */
export function dropUnknownTools(messages: UIMessage[], toolNames: Set<string>): UIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: settleInterruptedTools(m.parts).map((part) => {
      if (part.type === 'data-choice') {
        return { type: 'text', text: choiceText((part as { data?: unknown }).data) } as IPart;
      }
      if (!isToolPart(part) || toolNames.has(toolNameOf(part))) return part;
      return {
        type: 'text',
        text: `[earlier tool call ${toolNameOf(part)}: ${part.state}]`,
      } as IPart;
    }),
  }));
}

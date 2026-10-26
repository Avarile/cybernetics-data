import type { IAgentApproval, IAgentChatContext, IAgentChatRo } from '@teable/openapi';
import type { UIMessage } from 'ai';

type IPart = UIMessage['parts'][number];

export interface IAgentToolPart {
  type: string;
  toolCallId: string;
  toolName?: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
}

export const isToolPart = (part: IPart): part is IPart & IAgentToolPart =>
  part.type.startsWith('tool-') || part.type === 'dynamic-tool';

export const toolNameOf = (part: IAgentToolPart) =>
  part.type === 'dynamic-tool' ? part.toolName ?? '' : part.type.slice('tool-'.length);

export const textOf = (message: UIMessage) =>
  message.parts
    .filter((p): p is Extract<IPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');

/** The admin's answers in the last assistant message, ready to send. */
export function answeredApprovals(message: UIMessage | undefined): IAgentApproval[] {
  if (message?.role !== 'assistant') return [];
  return message.parts
    .filter(isToolPart)
    .filter((p) => p.state === 'approval-responded' && p.approval?.approved !== undefined)
    .map((p) => ({
      approvalId: p.approval!.id,
      approved: Boolean(p.approval!.approved),
      ...(p.approval!.reason ? { reason: p.approval!.reason } : {}),
    }));
}

/** Tool calls in the last assistant message that still wait for the admin. */
export const waitingApprovals = (message: UIMessage | undefined) =>
  message?.role === 'assistant'
    ? message.parts.filter(isToolPart).filter((p) => p.state === 'approval-requested')
    : [];

/**
 * The server keeps the conversation (design §10.1), so a request carries only what is new:
 * the user's message, or the answers to the approvals the last reply asked for.
 */
export function buildAgentRequestBody(
  messages: UIMessage[],
  options: { threadId?: string; context?: IAgentChatContext }
): IAgentChatRo {
  const last = messages.at(-1);
  const base = {
    ...(options.threadId ? { threadId: options.threadId } : {}),
    ...(options.context ? { context: options.context } : {}),
  };
  const approvals = answeredApprovals(last);
  if (last?.role === 'assistant' && approvals.length) return { ...base, approvals };
  if (last?.role === 'user') return { ...base, message: { text: textOf(last) } };
  throw new Error('Nothing to send');
}

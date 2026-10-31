import type { UIMessage } from 'ai';

/**
 * The parts of an agent reply the voice reads (voice design §6). The cockpit no longer chats
 * (scope design §13), so its voice hook is handed no replies; it keeps reading them for any view
 * that does.
 */
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

/** Tool calls in the last assistant message that still wait for the admin. */
export const waitingApprovals = (message: UIMessage | undefined) =>
  message?.role === 'assistant'
    ? message.parts.filter(isToolPart).filter((p) => p.state === 'approval-requested')
    : [];

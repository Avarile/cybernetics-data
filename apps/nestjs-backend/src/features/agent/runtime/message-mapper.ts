import type { UIMessage } from 'ai';
import type { IMessage } from '../domain/entities';
import { estimateTokens } from '../domain/policies/context-budget';

type IPart = UIMessage['parts'][number];

const parseParts = (json: string | null): IPart[] | undefined => {
  if (!json) return undefined;
  try {
    const parts = JSON.parse(json) as unknown;
    return Array.isArray(parts) && parts.length ? (parts as IPart[]) : undefined;
  } catch {
    return undefined;
  }
};

/** A stored message back as an AI SDK UI message; text-only when `parts` is missing or broken. */
export function toUIMessage(m: IMessage): UIMessage | undefined {
  if (m.role !== 'user' && m.role !== 'assistant') return undefined;
  const parts = parseParts(m.parts) ?? (m.content ? [{ type: 'text', text: m.content }] : []);
  if (!parts.length) return undefined;
  return { id: m.id, role: m.role, parts };
}

export const toUIMessages = (messages: IMessage[]) =>
  messages.map(toUIMessage).filter((m): m is UIMessage => !!m);

/** What a stored message costs in the prompt: its parts if any, else its text. */
export const messageTokens = (m: IMessage) => estimateTokens(m.parts ?? m.content);

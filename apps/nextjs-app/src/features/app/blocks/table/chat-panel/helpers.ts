import type { IGridSelection, IMessage } from './types';

export async function readStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (text: string) => void
) {
  const decoder = new TextDecoder();
  let result = await reader.read();
  while (!result.done) {
    const chunk = decoder.decode(result.value, { stream: true });
    if (chunk) onChunk(chunk);
    result = await reader.read();
  }
  const tail = decoder.decode();
  if (tail) onChunk(tail);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "report.final.docx" → "DOCX"; falls back to the mimetype subtype for extensionless names.
export function getFileTypeLabel(name: string, mimetype: string): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase();
  const subtype = mimetype.split('/').pop() ?? '';
  return subtype.length <= 8 ? subtype.toUpperCase() : 'FILE';
}

// Maps a failed chat request's HTTP status to an i18n key + English fallback.
export function getChatErrorMessage(status: number | undefined) {
  if (status === 401) {
    return {
      key: 'ai.chat.error.unauthorized',
      fallback: 'Your session has expired. Please sign in again.',
    } as const;
  }
  if (status === 403) {
    return {
      key: 'ai.chat.error.forbidden',
      fallback: "You don't have permission to use AI in this base.",
    } as const;
  }
  if (status === 429) {
    return {
      key: 'ai.chat.error.rateLimit',
      fallback: 'Too many requests. Please wait a moment and try again.',
    } as const;
  }
  if (status !== undefined && status >= 500) {
    return {
      key: 'ai.chat.error.server',
      fallback:
        'The AI service is unavailable. Check that an AI provider is configured, then try again.',
    } as const;
  }
  return {
    key: 'ai.chat.errorMessage',
    fallback: 'Something went wrong. Please try again.',
  } as const;
}

export function countSelectedRows(
  selection: IGridSelection | null,
  contextDismissed: boolean
): number {
  if (!selection?.addToChat || contextDismissed || !selection.rows) return 0;
  return selection.rows.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
}

export function loadStoredMessages(baseId: string): IMessage[] {
  try {
    const stored = localStorage.getItem(`chat-history:${baseId}`);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
      )
    ) {
      return parsed as IMessage[];
    }
    return [];
  } catch {
    return [];
  }
}

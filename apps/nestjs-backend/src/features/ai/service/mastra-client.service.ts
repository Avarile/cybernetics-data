import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface IMastraThread {
  id: string;
  resourceId: string;
  title?: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class MastraClientService {
  private readonly logger = new Logger(MastraClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('MASTRA_URL') ?? 'http://localhost:4111';
    this.apiKey = this.configService.get<string>('MASTRA_API_KEY');
    if (!this.apiKey) {
      this.logger.warn(
        '[mastra] MASTRA_API_KEY is not set — calls to the Mastra service will be unauthenticated'
      );
    }
  }

  /** Bearer auth header for the trusted backend → Mastra service calls. */
  private authHeaders(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  async createThread(resourceId: string, agentId: string, title?: string): Promise<IMastraThread> {
    const { data } = await axios.post<IMastraThread>(
      `${this.baseUrl}/api/memory/threads`,
      { resourceId, ...(title ? { title } : {}) },
      { params: { agentId }, timeout: 10_000, headers: this.authHeaders() }
    );
    return data;
  }

  async getThread(threadId: string, agentId?: string): Promise<IMastraThread | null> {
    try {
      // agentId lets Mastra resolve the owning agent's memory; without it the
      // handler throws "Memory is not initialized".
      const { data } = await axios.get<IMastraThread>(
        `${this.baseUrl}/api/memory/threads/${threadId}`,
        { params: agentId ? { agentId } : undefined, timeout: 10_000, headers: this.authHeaders() }
      );
      return data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  }

  async deleteThread(threadId: string, agentId?: string): Promise<void> {
    await axios.delete(`${this.baseUrl}/api/memory/threads/${threadId}`, {
      params: agentId ? { agentId } : undefined,
      timeout: 10_000,
      headers: this.authHeaders(),
    });
  }

  async listThreads(resourceId: string): Promise<IMastraThread[]> {
    const { data } = await axios.get<IMastraThread[] | { threads: IMastraThread[] }>(
      `${this.baseUrl}/api/memory/threads`,
      { params: { resourceId }, timeout: 10_000, headers: this.authHeaders() }
    );
    return Array.isArray(data) ? data : data.threads ?? [];
  }

  /**
   * Fetch a thread's prior messages, normalised to a simple {role, content}[]
   * shape. Parses defensively — unknown response shapes degrade to [] rather
   * than throwing, so the chat simply shows no history (M3).
   */
  async getThreadMessages(
    threadId: string,
    agentId: string
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    try {
      const { data } = await axios.get<unknown>(
        `${this.baseUrl}/api/memory/threads/${threadId}/messages`,
        { params: { agentId }, timeout: 10_000, headers: this.authHeaders() }
      );
      return this.normalizeMessages(data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return [];
      throw err;
    }
  }

  private normalizeMessages(data: unknown): { role: 'user' | 'assistant'; content: string }[] {
    const container = data as { uiMessages?: unknown; messages?: unknown };
    const raw: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray(container?.uiMessages)
        ? container.uiMessages
        : Array.isArray(container?.messages)
          ? container.messages
          : [];

    const out: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const item of raw) {
      const msg = item as Record<string, unknown>;
      const role = msg['role'];
      if (role !== 'user' && role !== 'assistant') continue;
      const content = this.extractMessageText(msg);
      if (content) out.push({ role, content });
    }
    return out;
  }

  private extractMessageText(msg: Record<string, unknown>): string {
    if (typeof msg['content'] === 'string') return msg['content'];
    const parts = msg['parts'] ?? msg['content'];
    if (Array.isArray(parts)) {
      return parts
        .map((p) => {
          const part = p as Record<string, unknown>;
          return typeof part['text'] === 'string' ? part['text'] : '';
        })
        .join('')
        .trim();
    }
    return '';
  }

  /**
   * Stream text from a Mastra agent, yielding text chunks.
   *
   * Handles two wire formats:
   * - Vercel AI SDK data stream: `0:"text chunk"\n`
   * - JSON-body SSE: `data: {"type":"text-delta","textDelta":"..."}\n\n`
   */
  async *streamAgent(
    agentId: string,
    body: {
      messages?: { role: 'user' | 'assistant'; content: string }[];
      prompt?: string;
      /** Passed to Mastra as the agent's requestContext (e.g. the signed aiDataContext). */
      requestContext?: Record<string, unknown>;
    },
    threadId: string,
    resourceId: string,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const response = await axios.post<NodeJS.ReadableStream>(
      `${this.baseUrl}/api/agents/${agentId}/stream`,
      { ...body, memory: { thread: threadId, resource: resourceId } },
      { responseType: 'stream', timeout: 120_000, headers: this.authHeaders(), signal }
    );

    const stream = response.data;
    let buffer = '';

    for await (const raw of stream) {
      buffer += Buffer.isBuffer(raw) ? raw.toString('utf-8') : String(raw);

      // Split on newlines; keep the last incomplete line in buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const frame = this.parseFrame(line);
        if (!frame) continue;
        if (frame.kind === 'error') throw new Error(frame.message);
        if (frame.text) yield frame.text;
      }
    }

    // Flush any remaining buffer content
    if (buffer) {
      const frame = this.parseFrame(buffer);
      if (frame?.kind === 'error') throw new Error(frame.message);
      if (frame?.kind === 'text' && frame.text) yield frame.text;
    }
  }

  /**
   * Parse a single stream line into a text or error frame. Recognises both the
   * Vercel AI SDK data-stream protocol (`0:`/`3:`) and Mastra's JSON SSE frames.
   * Unrecognised frame types are ignored (logged at debug) rather than dropped
   * silently, so an upstream error surfaces instead of looking like empty output.
   */
  private parseFrame(
    line: string
  ): { kind: 'text'; text: string } | { kind: 'error'; message: string } | null {
    let content = line.trim();
    if (!content) return null;

    if (content.startsWith('data:')) {
      content = content.slice(5).trim();
    }
    if (!content || content === '[DONE]') return null;

    // Vercel AI SDK data stream: 0: = text part, 3: = error part
    if (content.startsWith('0:')) {
      try {
        const text = JSON.parse(content.slice(2)) as string;
        return text ? { kind: 'text', text } : null;
      } catch {
        return null;
      }
    }
    if (content.startsWith('3:')) {
      try {
        const message = JSON.parse(content.slice(2)) as unknown;
        return { kind: 'error', message: typeof message === 'string' ? message : 'agent error' };
      } catch {
        return { kind: 'error', message: 'agent error' };
      }
    }

    // JSON object (Mastra SSE format)
    if (content.startsWith('{')) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const type = parsed['type'];

        if (type === 'text-delta') {
          // Mastra format: { type: 'text-delta', payload: { text: '...' } }
          const payload = parsed['payload'] as Record<string, unknown> | undefined;
          if (typeof payload?.['text'] === 'string') {
            return payload['text'] ? { kind: 'text', text: payload['text'] } : null;
          }
          // Legacy fallback: { type: 'text-delta', textDelta: '...' }
          if (typeof parsed['textDelta'] === 'string') {
            return parsed['textDelta'] ? { kind: 'text', text: parsed['textDelta'] } : null;
          }
          return null;
        }

        if (type === 'error' || type === 'error-delta') {
          const payload = parsed['payload'] as Record<string, unknown> | undefined;
          const message =
            (typeof payload?.['error'] === 'string' && payload['error']) ||
            (typeof payload?.['message'] === 'string' && payload['message']) ||
            (typeof parsed['error'] === 'string' && parsed['error']) ||
            'The agent reported an error.';
          return { kind: 'error', message: String(message) };
        }

        if (typeof type === 'string') {
          this.logger.debug(`[mastra] ignoring stream frame type: ${type}`);
        }
      } catch {
        /* ignore non-JSON lines */
      }
    }

    return null;
  }
}

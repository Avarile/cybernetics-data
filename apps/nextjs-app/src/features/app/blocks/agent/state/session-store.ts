import type { IAgentChatContext } from '@teable/openapi';
import type { UIMessage } from 'ai';
import { create } from 'zustand';
import { cancelRun, fetchSearch, fetchThreadMessages } from '../data/agent-api';
import { createAgentChat, type AgentChat, type IAgentDataChunk } from '../data/agent-chat';
import { boardEventOf } from '../data/stream-events';
import type { IAgentChoice } from '../model/agent-request';
import { emptyBoard, reduceBoard, type IBoard, type IBoardEvent } from '../model/search-board';

const threadKey = 'agent.cockpit.thread';
const remember = (threadId?: string) => {
  try {
    if (threadId) sessionStorage.setItem(threadKey, threadId);
    else sessionStorage.removeItem(threadKey);
  } catch {
    // storage blocked: the thread just is not reopened after a reload
  }
};
/** The thread this tab had open before a reload. */
export const rememberedThread = () => {
  try {
    return sessionStorage.getItem(threadKey) ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * One conversation with the agent (cockpit design §10.2). It lives outside React, so turning the
 * cockpit off or moving between pages keeps the reply streaming; React subscribes to it.
 */
export class AgentSession {
  readonly chat: AgentChat;
  threadId?: string;
  runId?: string;
  /** Read when a message is sent: focus hint and voice. */
  context?: IAgentChatContext;
  /** The searches of this conversation, live or replayed (cockpit design §10.3). */
  boards: Record<string, IBoard> = {};
  /** The search the latest reply made. */
  latestSearchId?: string;
  private readonly loading = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly dataListeners = new Set<(part: IAgentDataChunk) => void>();
  private version = 0;

  constructor(init: { threadId?: string; initialMessages: UIMessage[] }) {
    this.threadId = init.threadId;
    this.chat = createAgentChat({
      initialMessages: init.initialMessages,
      request: () => ({ threadId: this.threadId, context: this.context }),
      onRun: ({ threadId, runId }) => {
        this.runId = runId;
        if (this.threadId !== threadId) {
          this.threadId = threadId;
          remember(threadId);
        }
        this.emit();
      },
      onData: (part) => {
        const event = boardEventOf(part);
        if (event) this.apply(event);
        this.dataListeners.forEach((l) => l(part));
      },
    });
  }

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  /** A search event onto its board. */
  apply(event: IBoardEvent) {
    const id = event.type === 'replay' ? event.search.id : event.searchId;
    const before = this.boards[id];
    this.boards = { ...this.boards, [id]: reduceBoard(before ?? emptyBoard(id), event) };
    if (!before && event.type !== 'replay') this.latestSearchId = id;
    this.emit();
  }

  /** A stored search onto the board (a reopened thread, or an earlier plan clicked). */
  async loadSearch(searchId: string) {
    if (this.boards[searchId]?.plan || this.loading.has(searchId)) return;
    this.loading.add(searchId);
    try {
      this.apply({ type: 'replay', search: await fetchSearch(searchId) });
    } catch {
      // gone or not ours: the plan legs in the transcript still show what it was
    } finally {
      this.loading.delete(searchId);
    }
  }

  /** Search progress, clarify cards and lenses as they stream (transient parts included). */
  onData(listener: (part: IAgentDataChunk) => void) {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  get busy() {
    const status = this.chat.store.status;
    return status === 'submitted' || status === 'streaming';
  }

  send(text: string, choice?: IAgentChoice) {
    return this.chat.sendMessage({ text, ...(choice ? { metadata: { choice } } : {}) });
  }

  respond(approvalId: string, approved: boolean, reason?: string) {
    return this.chat.addToolApprovalResponse({ id: approvalId, approved, reason });
  }

  /** Stop: the stream closes and the run is cancelled (also one that waits for approval). */
  async stop() {
    const runId = this.runId;
    await this.chat.stop();
    if (runId) await cancelRun(runId);
  }
}

interface ISessionState {
  session: AgentSession | null;
  /** A thread's messages are being fetched. */
  loading: boolean;
  error?: string;
  /** The session, created empty on first use. */
  ensure: () => AgentSession;
  openThread: (threadId: string) => Promise<void>;
  startNew: () => void;
}

let opening = 0;

export const useSessionStore = create<ISessionState>()((set, get) => {
  const replace = (session: AgentSession) => {
    const old = get().session;
    if (old?.busy) void old.stop();
    set({ session, loading: false, error: undefined });
  };
  return {
    session: null,
    loading: false,
    ensure: () => {
      const current = get().session;
      if (current) return current;
      const session = new AgentSession({ initialMessages: [] });
      set({ session });
      return session;
    },
    openThread: async (threadId) => {
      if (get().session?.threadId === threadId) return;
      const token = ++opening;
      set({ loading: true, error: undefined });
      try {
        const initialMessages = await fetchThreadMessages(threadId);
        if (token !== opening) return;
        remember(threadId);
        replace(new AgentSession({ threadId, initialMessages }));
      } catch (error) {
        if (token !== opening) return;
        set({ loading: false, error: (error as Error).message });
      }
    },
    startNew: () => {
      opening++;
      remember(undefined);
      replace(new AgentSession({ initialMessages: [] }));
    },
  };
});

import type { IAgentChatContext, IAgentRunData } from '@teable/openapi';
import { AGENT_CHAT, AGENT_DATA_PART } from '@teable/openapi';
import type { ChatState, ChatStatus, UIMessage } from 'ai';
import {
  AbstractChat,
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import { buildAgentRequestBody } from '../model/agent-request';

/** ChatState that React can subscribe to (what `@ai-sdk/react` does, on the `ai` we already ship). */
export class StoreChatState implements ChatState<UIMessage> {
  status: ChatStatus = 'ready';
  error: Error | undefined = undefined;
  messages: UIMessage[];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(messages: UIMessage[]) {
    this.messages = messages;
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

  pushMessage = (message: UIMessage) => {
    this.messages = [...this.messages, message];
    this.emit();
  };

  popMessage = () => {
    this.messages = this.messages.slice(0, -1);
    this.emit();
  };

  replaceMessage = (index: number, message: UIMessage) => {
    this.messages = [...this.messages.slice(0, index), message, ...this.messages.slice(index + 1)];
    this.emit();
  };

  snapshot = <T>(thing: T): T => structuredClone(thing);

  setStatus(status: ChatStatus, error?: Error) {
    this.status = status;
    this.error = error;
    this.emit();
  }
}

export class AgentChat extends AbstractChat<UIMessage> {
  constructor(
    readonly store: StoreChatState,
    init: ConstructorParameters<typeof AbstractChat<UIMessage>>[0]
  ) {
    super(init);
  }

  protected setStatus(args: { status: ChatStatus; error?: Error }) {
    super.setStatus(args);
    this.store.setStatus(args.status, args.error);
  }
}

/** A data part of the stream, as `onData` hands it over. */
export interface IAgentDataChunk {
  type: string;
  id?: string;
  data: unknown;
}

export interface IAgentChatOptions {
  initialMessages: UIMessage[];
  /** Read when a request is sent: the thread so far, and the focus/voice context. */
  request: () => { threadId?: string; context?: IAgentChatContext };
  /** The first part of every reply: which thread and run it belongs to. */
  onRun: (data: IAgentRunData) => void;
  /** Every other data part (search progress, clarify cards, lenses). */
  onData?: (part: IAgentDataChunk) => void;
}

/**
 * The agent conversation over POST /api/agent/chat, streamed. Approvals answered with
 * `addToolApprovalResponse` are sent as soon as every pending one has an answer.
 */
export function createAgentChat(options: IAgentChatOptions): AgentChat {
  const store = new StoreChatState(options.initialMessages);
  return new AgentChat(store, {
    state: store,
    transport: new DefaultChatTransport({
      api: `/api${AGENT_CHAT}`,
      credentials: 'include',
      prepareSendMessagesRequest: ({ messages }) => ({
        body: buildAgentRequestBody(messages, options.request()),
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onData: (part) => {
      if (part.type === AGENT_DATA_PART.run) options.onRun(part.data as IAgentRunData);
      else options.onData?.(part as IAgentDataChunk);
    },
  });
}

import type { IAgentChatContext, IAgentRunData } from '@teable/openapi';
import { AGENT_CHAT, cancelAgentRun } from '@teable/openapi';
import type { ChatState, ChatStatus, UIMessage } from 'ai';
import {
  AbstractChat,
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { buildAgentRequestBody } from './agent-request';

/** ChatState that React can subscribe to (what `@ai-sdk/react` does, on the `ai` we already ship). */
class StoreChatState implements ChatState<UIMessage> {
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

class AgentChat extends AbstractChat<UIMessage> {
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

export interface IUseAgentChat {
  messages: UIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  threadId?: string;
  send: (text: string) => Promise<void>;
  respond: (approvalId: string, approved: boolean, reason?: string) => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * The agent conversation in the browser: sends to POST /api/agent/chat and streams the reply.
 * Approvals answered with `respond` are sent as soon as every pending one has an answer.
 */
export function useAgentChat(options: {
  threadId?: string;
  initialMessages?: UIMessage[];
  context?: IAgentChatContext;
  onThread?: (threadId: string) => void;
}): IUseAgentChat {
  const threadRef = useRef(options.threadId);
  const runRef = useRef<string>();
  const contextRef = useRef(options.context);
  contextRef.current = options.context;
  const onThreadRef = useRef(options.onThread);
  onThreadRef.current = options.onThread;

  const [chat] = useState(() => {
    const store = new StoreChatState(options.initialMessages ?? []);
    return new AgentChat(store, {
      state: store,
      transport: new DefaultChatTransport({
        api: `/api${AGENT_CHAT}`,
        credentials: 'include',
        prepareSendMessagesRequest: ({ messages }) => ({
          body: buildAgentRequestBody(messages, {
            threadId: threadRef.current,
            context: contextRef.current,
          }),
        }),
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      onData: (part) => {
        if (part.type !== 'data-run') return;
        const data = part.data as IAgentRunData;
        runRef.current = data.runId;
        if (threadRef.current !== data.threadId) {
          threadRef.current = data.threadId;
          onThreadRef.current?.(data.threadId);
        }
      },
    });
  });

  useSyncExternalStore(chat.store.subscribe, chat.store.getVersion, chat.store.getVersion);

  useEffect(() => {
    return () => {
      void chat.stop();
    };
  }, [chat]);

  const send = useCallback((text: string) => chat.sendMessage({ text }), [chat]);
  const respond = useCallback(
    async (approvalId: string, approved: boolean, reason?: string) => {
      await chat.addToolApprovalResponse({ id: approvalId, approved, reason });
    },
    [chat]
  );
  const stop = useCallback(async () => {
    const runId = runRef.current;
    await chat.stop();
    // closing the stream already stops the run; cancelling also covers a run that waits for approval
    if (runId) await cancelAgentRun(runId).catch(() => undefined);
  }, [chat]);

  return {
    messages: chat.store.messages,
    status: chat.store.status,
    error: chat.store.error,
    threadId: threadRef.current,
    send,
    respond,
    stop,
  };
}

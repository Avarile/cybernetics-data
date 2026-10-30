import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { agentQueryKeys } from '../data/agent-api';
import type { IAgentChoice } from '../model/agent-request';
import { useSessionStore, type AgentSession } from '../state/session-store';

const noop = () => () => undefined;
const zero = () => 0;

/**
 * The live conversation for the cockpit (cockpit design §10.2): messages and status of the
 * session in the store, and the actions on it. The thread list refreshes when a turn ends or a
 * new thread starts.
 */
export function useAgentSession() {
  const session = useSessionStore((s) => s.session);
  const loading = useSessionStore((s) => s.loading);
  const loadError = useSessionStore((s) => s.error);
  const queryClient = useQueryClient();
  useSyncExternalStore(
    session?.chat.store.subscribe ?? noop,
    session?.chat.store.getVersion ?? zero,
    session?.chat.store.getVersion ?? zero
  );
  useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getVersion ?? zero,
    session?.getVersion ?? zero
  );

  useEffect(() => {
    if (!session) useSessionStore.getState().ensure();
  }, [session]);

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: agentQueryKeys.threads }),
    [queryClient]
  );
  // a reply that started a thread: the thread list gets it
  const lastThread = useRef(session?.threadId);
  useEffect(() => {
    if (session?.threadId && session.threadId !== lastThread.current) refresh();
    lastThread.current = session?.threadId;
  });

  // the same functions for as long as the session lasts, so memoized views can skip renders
  const actions = useMemo(() => {
    const withSession =
      <A extends unknown[]>(fn: (s: AgentSession, ...args: A) => PromiseLike<void> | void) =>
      (...args: A) =>
        session ? Promise.resolve(fn(session, ...args)).then(refresh) : Promise.resolve();
    return {
      send: withSession((s, text: string, choice?: IAgentChoice) => s.send(text, choice)),
      respond: withSession((s, approvalId: string, approved: boolean) =>
        s.respond(approvalId, approved)
      ),
      stop: () => session?.stop() ?? Promise.resolve(),
      openThread: (threadId: string) => useSessionStore.getState().openThread(threadId),
      startNew: () => useSessionStore.getState().startNew(),
    };
  }, [session, refresh]);

  const status = session?.chat.store.status ?? 'ready';
  return {
    session,
    loading,
    loadError,
    messages: session?.chat.store.messages ?? [],
    status,
    error: session?.chat.store.error,
    busy: status === 'submitted' || status === 'streaming',
    threadId: session?.threadId,
    ...actions,
  };
}

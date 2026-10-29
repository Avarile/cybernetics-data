import { useEffect, useMemo } from 'react';
import { searchesOf } from '../model/transcript';
import { useCockpitStore } from '../state/cockpit-store';
import { useAgentSession } from './useAgentSession';

/**
 * The search on the stage (cockpit design §10.3): the one picked in the transcript, else the
 * latest. A stored search not on a board yet is replayed from the server.
 */
export function useSearchBoard() {
  const chat = useAgentSession();
  const selected = useCockpitStore((s) => s.selectedSearch);
  const searches = useMemo(() => searchesOf(chat.messages), [chat.messages]);
  const session = chat.session;
  const searchId = selected ?? session?.latestSearchId ?? searches.at(-1)?.searchId;
  const board = searchId ? session?.boards[searchId] : undefined;
  useEffect(() => {
    if (searchId && session && !board?.plan) void session.loadSearch(searchId);
  }, [searchId, session, board?.plan]);
  return { board, searchId, searches, chat };
}

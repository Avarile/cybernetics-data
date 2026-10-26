import type { IMemory } from '../entities';

/**
 * MemoryRanking (design §10.1 step 3). v1 ranks by word overlap with the message, importance and
 * recency; P4 replaces the overlap with hybrid (vector + full-text) search over the same rows.
 */
export const RELEVANT_MEMORY_LIMIT = 8;

const words = (text: string | null | undefined) =>
  new Set(
    (text ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 || /\p{Script=Han}/u.test(w))
  );

/** Expired and forgotten memories never reach the model. */
export const isLive = (m: IMemory, now: Date) =>
  m.isActive && !(m.expiresAt && new Date(m.expiresAt).getTime() < now.getTime());

/** Memories the scope allows for this turn: global, the admin's own, the focused base, the thread. */
export function inScope(
  m: IMemory,
  scope: { userId: string; baseId?: string | null; threadId?: string | null }
) {
  switch (m.scope ?? 'global') {
    case 'global':
      return true;
    case 'user':
      return m.scopeRef === scope.userId;
    case 'base':
      return !!scope.baseId && m.scopeRef === scope.baseId;
    case 'thread':
      return !!scope.threadId && m.scopeRef === scope.threadId;
    default:
      return false;
  }
}

/** The top memories that share words with the query (pinned ones are injected separately). */
export function rankMemories(
  memories: IMemory[],
  query: string,
  options: { now: Date; limit?: number }
): IMemory[] {
  const q = words(query);
  if (!q.size) return [];
  const scored = memories
    .filter((m) => !m.pinned && isLive(m, options.now))
    .map((m) => {
      const own = words(`${m.title} ${m.content ?? ''} ${m.tags.join(' ')}`);
      let overlap = 0;
      for (const w of q) if (own.has(w)) overlap++;
      const ageDays = m.createdAt
        ? (options.now.getTime() - new Date(m.createdAt).getTime()) / 86_400_000
        : 365;
      const recency = Math.max(0, 1 - ageDays / 365);
      return { m, overlap, score: overlap * 2 + (m.importance ?? 3) * 0.3 + recency * 0.5 };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, options.limit ?? RELEVANT_MEMORY_LIMIT).map((s) => s.m);
}

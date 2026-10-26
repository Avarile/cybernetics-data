/**
 * ContextBudget (design §10.1 step 3): what fits into one model call. Token counts are estimated
 * (about 4 characters per token) because providers count differently and the budget only has
 * to be safe, not exact.
 */

/** Used when the profile leaves `context_budget_tokens` empty. */
export const DEFAULT_CONTEXT_BUDGET = 24_000;
/** History always gets at least this much, even after a very long system prompt. */
export const MIN_HISTORY_BUDGET = 2_000;
/** Pinned memories are always injected, but never more than this. */
export const PINNED_MEMORY_BUDGET = 2_000;

export const estimateTokens = (text: string | null | undefined) =>
  text ? Math.ceil(text.length / 4) : 0;

/** Tokens left for the conversation once the system prompt is in. */
export function historyBudget(contextBudgetTokens: number | null, systemTokens: number) {
  const total =
    contextBudgetTokens && contextBudgetTokens > 0 ? contextBudgetTokens : DEFAULT_CONTEXT_BUDGET;
  return Math.max(MIN_HISTORY_BUDGET, total - systemTokens);
}

/**
 * The newest items that fit, in their original order. The newest item is always kept (the
 * current user message must reach the model), even if it alone is over budget.
 */
export function fitNewest<T>(
  items: T[],
  tokensOf: (item: T) => number,
  budget: number
): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const cost = tokensOf(items[i]);
    if (kept.length > 0 && used + cost > budget) break;
    used += cost;
    kept.unshift(items[i]);
  }
  return { kept, dropped: items.length - kept.length };
}

/** The first items (already ranked) that fit. */
export function fitFirst<T>(items: T[], tokensOf: (item: T) => number, budget: number): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const cost = tokensOf(item);
    if (used + cost > budget) break;
    used += cost;
    kept.push(item);
  }
  return kept;
}

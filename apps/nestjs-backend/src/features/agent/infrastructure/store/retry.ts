/** Postgres deadlock and serialization failures: the transaction was rolled back and can rerun. */
const transientCodes = new Set(['40P01', '40001']);

export function isTransientConflict(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string }; message?: string } | undefined;
  if (!e) return false;
  if (e.code === 'P2034') return true;
  if (transientCodes.has(e.code ?? '') || transientCodes.has(e.meta?.code ?? '')) return true;
  return /deadlock detected|could not serialize access/i.test(e.message ?? '');
}

/**
 * Runs a write again when Postgres aborted it for a deadlock. Agent turns and their background
 * jobs (title, usage, memory) write linked rows of the Agent base at the same time, so a
 * deadlock between them is expected now and then; the write itself is fine to repeat.
 */
export async function retryOnConflict<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isTransientConflict(error)) throw error;
      await new Promise((r) => setTimeout(r, 40 * 2 ** attempt + Math.random() * 40));
    }
  }
}

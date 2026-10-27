import Keyv from 'keyv';
import { CacheService } from '../../../../cache/cache.service';
import { TurnGate } from './turn-gate';

describe('TurnGate.lock', () => {
  const cache = new CacheService(new Keyv());
  const gate = new TurnGate(
    ...([null, null, cache, null, null, null, null, null] as unknown as ConstructorParameters<
      typeof TurnGate
    >)
  );
  const key = 'lock:agent-thread:recT' as const;

  it('allows one holder at a time and frees the lock on release', async () => {
    const release = await gate.lock('recT');
    await expect(gate.lock('recT')).rejects.toThrow(/already has a reply/);
    await release();
    const again = await gate.lock('recT');
    await again();
  });

  it('a late release never frees a lock someone else took after it expired', async () => {
    const stale = await gate.lock('recT');
    await cache.del(key); // the TTL ran out
    const current = await gate.lock('recT');
    await stale();
    expect(await cache.get(key)).toBeDefined();
    await expect(gate.lock('recT')).rejects.toThrow(/already has a reply/);
    await current();
    expect(await cache.get(key)).toBeUndefined();
  });
});

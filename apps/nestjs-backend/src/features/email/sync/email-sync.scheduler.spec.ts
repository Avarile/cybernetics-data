import { isDue } from './email-sync.scheduler';

describe('isDue', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const config = JSON.stringify({ intervalMin: 15 });
  const minutesAgo = (m: number) => new Date(now - m * 60_000);

  it('syncs a new source right away', () => {
    expect(
      isDue({ status: 'idle', config, lastSyncedTime: null, lastModifiedTime: null }, now)
    ).toBe(true);
  });

  it('waits for the interval after a sync', () => {
    const source = { status: 'idle', config, lastModifiedTime: minutesAgo(1) };
    expect(isDue({ ...source, lastSyncedTime: minutesAgo(10) }, now)).toBe(false);
    expect(isDue({ ...source, lastSyncedTime: minutesAgo(15) }, now)).toBe(true);
  });

  it('waits a full interval after a failure', () => {
    const source = { status: 'error', config, lastSyncedTime: minutesAgo(600) };
    expect(isDue({ ...source, lastModifiedTime: minutesAgo(5) }, now)).toBe(false);
    expect(isDue({ ...source, lastModifiedTime: minutesAgo(16) }, now)).toBe(true);
  });

  it('restarts a run that has been syncing for too long', () => {
    const source = { status: 'syncing', config, lastSyncedTime: null };
    expect(isDue({ ...source, lastModifiedTime: minutesAgo(5) }, now)).toBe(false);
    expect(isDue({ ...source, lastModifiedTime: minutesAgo(31) }, now)).toBe(true);
  });
});

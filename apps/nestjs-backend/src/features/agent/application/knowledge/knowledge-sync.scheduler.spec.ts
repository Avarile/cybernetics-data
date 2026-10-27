import type { ISyncState } from '../../domain/ports';
import { fullSyncDue } from './knowledge-sync.scheduler';

const hour = 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 27, 12);
const state = (over: Partial<ISyncState>): ISyncState => ({
  tableId: '*',
  collectionId: null,
  status: 'done',
  records: 10,
  error: null,
  startedTime: new Date(now - 2 * hour),
  finishedTime: new Date(now - hour),
  ...over,
});

describe('fullSyncDue', () => {
  it('is due when it never ran, and daily after that', () => {
    expect(fullSyncDue(undefined, now)).toBe(true);
    expect(fullSyncDue(state({}), now)).toBe(false);
    expect(fullSyncDue(state({ finishedTime: new Date(now - 25 * hour) }), now)).toBe(true);
  });

  it('tries a failed sync again after an hour, and a crashed one after two', () => {
    expect(
      fullSyncDue(state({ status: 'failed', finishedTime: new Date(now - hour / 2) }), now)
    ).toBe(false);
    expect(
      fullSyncDue(state({ status: 'failed', finishedTime: new Date(now - 2 * hour) }), now)
    ).toBe(true);
    expect(fullSyncDue(state({ status: 'running', startedTime: new Date(now - hour) }), now)).toBe(
      false
    );
    expect(
      fullSyncDue(state({ status: 'running', startedTime: new Date(now - 3 * hour) }), now)
    ).toBe(true);
  });
});

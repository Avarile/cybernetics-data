/* eslint-disable @typescript-eslint/no-explicit-any */
import { instanceReducer } from './reducer';

const factory = (data: any) => ({ ...data });
const doc = (id: string, data: unknown = { id }) => ({ id, data }) as any;
const state = (ids: string[]) => ({ instances: ids.map((id) => ({ id })), extra: undefined });

describe('instanceReducer', () => {
  it('maps the server insert index onto instances when some results are not instances', () => {
    // Server results: [a, pending(no data), b]; insert c at server index 2
    const next = instanceReducer(
      state(['a', 'b']),
      { type: 'insert', docs: [doc('c')], index: 2, precedingIds: ['a', 'pending'] },
      factory
    );
    expect(next.instances.map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('removes by doc id instead of server index', () => {
    const next = instanceReducer(
      state(['a', 'b', 'c']),
      { type: 'remove', docs: [doc('c')], index: 3 },
      factory
    );
    expect(next.instances.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('moves by doc id and keeps the moved instances', () => {
    const current = state(['a', 'b', 'c']);
    const next = instanceReducer(
      current,
      { type: 'move', docs: [doc('c')], from: 3, to: 0, precedingIds: [] },
      factory
    );
    expect(next.instances.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(next.instances[0]).toBe(current.instances[2]);
  });
});

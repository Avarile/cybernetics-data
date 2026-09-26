import { createGraphStore } from './createGraphStore';

describe('createGraphStore', () => {
  it('gives each store its own state — nothing leaks between bases', () => {
    const a = createGraphStore();
    const b = createGraphStore();
    a.getState().toggleNode('rec:x');
    a.getState().setFocusedNode('rec:y');
    expect(b.getState().hiddenNodeIds).toEqual([]);
    expect(b.getState().focusedNodeId).toBeNull();
  });

  it('seeds focus, toggles exclusions, and resets view state', () => {
    const s = createGraphStore({ focusedNodeId: 'rec:seed' });
    expect(s.getState().focusedNodeId).toBe('rec:seed');
    s.getState().toggleTable('tblA');
    s.getState().toggleTable('tblA');
    s.getState().toggleTable('tblB');
    expect(s.getState().hiddenTableIds).toEqual(['tblB']);
    s.getState().addExpansion({ nodes: [], links: [], truncated: false });
    s.getState().resetView();
    expect(s.getState()).toMatchObject({
      focusedNodeId: null,
      hiddenTableIds: [],
      expansions: [],
    });
  });
});

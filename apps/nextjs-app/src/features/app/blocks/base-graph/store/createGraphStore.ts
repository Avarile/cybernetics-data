import type { IBaseGraphExpandVo } from '@teable/openapi';
import { createStore } from 'zustand/vanilla';

export interface IGraphViewState {
  focusedNodeId: string | null;
  /** EXCLUSIONS, not inclusions — an empty list means "show everything". */
  hiddenNodeIds: string[];
  hiddenTableIds: string[];
  autoRotate: boolean;
  showLegend: boolean;
  showQueryPanel: boolean;
  /** null = automatic: 2D above AUTO_2D_NODE_COUNT visible nodes, else 3D. */
  renderMode: '3d' | '2d' | null;
  /** Neighbourhoods the user loaded on demand; cleared when the query changes. */
  expansions: IBaseGraphExpandVo[];

  setFocusedNode: (nodeId: string | null) => void;
  toggleNode: (nodeId: string) => void;
  toggleTable: (tableId: string) => void;
  showAll: () => void;
  setAutoRotate: (on: boolean) => void;
  toggleLegend: () => void;
  toggleQueryPanel: () => void;
  setRenderMode: (mode: '3d' | '2d') => void;
  addExpansion: (expansion: IBaseGraphExpandVo) => void;
  clearExpansions: () => void;
  resetView: () => void;
}

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

const INITIAL_VIEW = {
  focusedNodeId: null,
  hiddenNodeIds: [] as string[],
  hiddenTableIds: [] as string[],
  autoRotate: true,
  showLegend: true,
  expansions: [] as IBaseGraphExpandVo[],
};

/**
 * One store per mounted graph, not a module singleton: GraphStoreProvider is
 * keyed by baseId, so another base gets a fresh store by construction and no
 * hidden ids or focus can leak across bases.
 *
 * What is fetched lives in the URL, not here — this is view state only.
 * Fullscreen is absent on purpose: the browser owns it (see useFullscreen).
 */
export const createGraphStore = (initial: Partial<Pick<IGraphViewState, 'focusedNodeId'>> = {}) =>
  createStore<IGraphViewState>()((set) => ({
    ...INITIAL_VIEW,
    showQueryPanel: true,
    renderMode: null,
    ...initial,
    setFocusedNode: (focusedNodeId) => set({ focusedNodeId }),
    toggleNode: (nodeId) => set((s) => ({ hiddenNodeIds: toggle(s.hiddenNodeIds, nodeId) })),
    toggleTable: (tableId) => set((s) => ({ hiddenTableIds: toggle(s.hiddenTableIds, tableId) })),
    showAll: () => set({ hiddenNodeIds: [], hiddenTableIds: [] }),
    setAutoRotate: (autoRotate) => set({ autoRotate }),
    toggleLegend: () => set((s) => ({ showLegend: !s.showLegend })),
    toggleQueryPanel: () => set((s) => ({ showQueryPanel: !s.showQueryPanel })),
    setRenderMode: (renderMode) => set({ renderMode }),
    addExpansion: (expansion) => set((s) => ({ expansions: [...s.expansions, expansion] })),
    clearExpansions: () => set({ expansions: [] }),
    resetView: () => set(INITIAL_VIEW),
  }));

export type IGraphStore = ReturnType<typeof createGraphStore>;

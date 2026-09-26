import type { ReactNode } from 'react';
import { createContext, useContext, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { IGraphStore, IGraphViewState } from './createGraphStore';
import { createGraphStore } from './createGraphStore';

const GraphStoreContext = createContext<IGraphStore | null>(null);

/** Mount with `key={baseId}` so each base gets its own store. */
export const GraphStoreProvider = (props: {
  children: ReactNode;
  initialFocus?: string | null;
}) => {
  const [store] = useState(() => createGraphStore({ focusedNodeId: props.initialFocus ?? null }));
  return <GraphStoreContext.Provider value={store}>{props.children}</GraphStoreContext.Provider>;
};

const useStoreInstance = (): IGraphStore => {
  const store = useContext(GraphStoreContext);
  if (!store) {
    throw new Error('useGraphStore must be used inside GraphStoreProvider');
  }
  return store;
};

export function useGraphStore<T>(selector: (state: IGraphViewState) => T): T {
  return useStore(useStoreInstance(), selector);
}

/**
 * The store's actions, with stable identities: zustand replaces the state
 * object on every set but keeps the same function references, so reading them
 * once does not subscribe the caller to every state change.
 */
export const useGraphActions = () => {
  const store = useStoreInstance();
  return useMemo(() => {
    const {
      setFocusedNode,
      toggleNode,
      toggleTable,
      showAll,
      setAutoRotate,
      toggleLegend,
      toggleQueryPanel,
      setRenderMode,
      addExpansion,
      clearExpansions,
      resetView,
    } = store.getState();
    return {
      setFocusedNode,
      toggleNode,
      toggleTable,
      showAll,
      setAutoRotate,
      toggleLegend,
      toggleQueryPanel,
      setRenderMode,
      addExpansion,
      clearExpansions,
      resetView,
    };
  }, [store]);
};

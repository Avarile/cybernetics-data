import type { Doc } from 'sharedb/lib/client';

export type IInstanceAction<T> =
  | { type: 'update'; doc: Doc<T> }
  | { type: 'ready'; results: Doc<T>[]; extra: unknown }
  // precedingIds: ids before the change in the server results, which can hold docs that are not
  // instances (no data yet, hidden locally), so the server index is mapped onto instances
  | { type: 'insert'; docs: Doc<T>[]; index: number; precedingIds?: string[] }
  | { type: 'remove'; docs: Doc<T>[]; index: number }
  | { type: 'removeByIds'; ids: string[] }
  | { type: 'move'; docs: Doc<T>[]; from: number; to: number; precedingIds?: string[] }
  | { type: 'clear' }
  | { type: 'extra'; extra: unknown };

export interface IInstanceState<R> {
  instances: R[];
  extra: unknown;
}

const hasDocData = <T>(doc: Doc<T>): doc is Doc<T> & { data: T } => {
  return doc.data != null;
};

const getInstanceIndex = <R extends { id: string }>(
  instances: R[],
  index: number,
  precedingIds?: string[]
) => {
  if (!precedingIds) {
    return index;
  }
  const preceding = new Set(precedingIds);
  return instances.filter((instance) => preceding.has(instance.id)).length;
};

export function instanceReducer<T, R extends { id: string }>(
  state: IInstanceState<R>,
  action: IInstanceAction<T>,
  factory: (data: T, doc?: Doc<T>) => R
): IInstanceState<R> {
  switch (action.type) {
    case 'update': {
      if (!hasDocData(action.doc)) {
        return state;
      }

      return {
        ...state,
        instances: state.instances.map((instance) => {
          if (instance.id === action.doc.id) {
            return factory(action.doc.data, action.doc);
          }
          return instance;
        }),
      };
    }
    case 'ready':
      return {
        ...state,
        instances: action.results.filter(hasDocData).map((r) => factory(r.data, r)),
        extra: action.extra,
      };
    case 'insert': {
      const index = getInstanceIndex(state.instances, action.index, action.precedingIds);
      return {
        ...state,
        instances: [
          ...state.instances.slice(0, index),
          ...action.docs.filter(hasDocData).map((doc) => factory(doc.data, doc)),
          ...state.instances.slice(index),
        ],
      };
    }
    case 'remove': {
      // Remove by id: the server index can be off when some result docs are not instances
      const removedIds = new Set(action.docs.map((doc) => doc.id));
      return {
        ...state,
        instances: state.instances.filter((instance) => !removedIds.has(instance.id)),
      };
    }
    case 'removeByIds': {
      const deletedIds = new Set(action.ids);
      return {
        ...state,
        instances: state.instances.filter((instance) => !deletedIds.has(instance.id)),
      };
    }
    case 'move': {
      const { docs, to, precedingIds } = action;
      const movedIds = new Set(docs.map((doc) => doc.id));
      const instanceMap = new Map(state.instances.map((instance) => [instance.id, instance]));
      const moveInstances = docs
        .map((doc) => instanceMap.get(doc.id))
        .filter((instance): instance is R => instance != null);
      const newInstances = state.instances.filter((instance) => !movedIds.has(instance.id));
      const index = getInstanceIndex(newInstances, to, precedingIds);
      newInstances.splice(index, 0, ...moveInstances);
      return {
        ...state,
        instances: newInstances,
      };
    }
    case 'clear': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (state.instances[0] && (state.instances[0] as any).doc) {
        return {
          ...state,
          instances: [],
          extra: undefined,
        };
      }
      return state;
    }
    case 'extra': {
      return {
        ...state,
        extra: action.extra,
      };
    }
    default:
      return state;
  }
}

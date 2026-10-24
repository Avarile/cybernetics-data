import type { IFilterItem, IFilterSet } from '@cybernetics/core';

function isFilterItem(item: unknown): item is IFilterItem {
  return !Array.isArray((item as IFilterSet)?.filterSet);
}

export { isFilterItem };

import type { FieldCore } from '@cybernetics/core';
import { getValidFilterOperators } from '@cybernetics/core';
import { useMemo } from 'react';

export const useOperators = (field?: FieldCore) => {
  return useMemo(() => {
    if (!field) {
      return [];
    }
    return getValidFilterOperators(field);
  }, [field]);
};

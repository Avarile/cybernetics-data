import type { IFilter } from '@teable/core';
import { isEqual } from 'lodash';
import { useRef, useState } from 'react';
import { useDebounce, useUpdateEffect } from 'react-use';

/**
 * Keep an editable local copy of `filters` and push it through `onChange` after a debounce.
 *
 * Server updates are only accepted while no local edit is pending, so a stale response
 * (user adds A, then B, server answers with A only) cannot overwrite newer local edits.
 * Changing `resetKey` (the view id) drops local edits that belong to the previous view.
 */
export const useLocalFilterSync = (
  filters: IFilter,
  onChange: (value: IFilter) => void,
  resetKey?: string
) => {
  const [filter, setFilter] = useState(filters);
  const localEditVersionRef = useRef(0);
  const lastSyncedVersionRef = useRef(0);

  useUpdateEffect(() => {
    if (localEditVersionRef.current === lastSyncedVersionRef.current && !isEqual(filters, filter)) {
      setFilter(filters);
    }
  }, [filters]);

  useUpdateEffect(() => {
    lastSyncedVersionRef.current = localEditVersionRef.current;
    setFilter(filters);
  }, [resetKey]);

  const onLocalChange = (value: IFilter) => {
    localEditVersionRef.current += 1;
    setFilter(value);
  };

  useDebounce(
    () => {
      const currentVersion = localEditVersionRef.current;
      if (!isEqual(filter, filters)) {
        onChange(filter);
      }
      // An edit that ends up equal to the server value has nothing to send,
      // but it still counts as synced so later server updates are accepted.
      lastSyncedVersionRef.current = currentVersion;
    },
    300,
    [filter]
  );

  return [filter, onLocalChange] as const;
};

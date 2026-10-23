import { BaseViewFilter, useViewFilterLinkContext } from '@cybernetics/sdk';
import { useFields, useViewId, useTableId, useTablePermission } from '@cybernetics/sdk/hooks';
import type { IFilterSet } from '@teable/core';

export const FilterBuilder = ({
  filter,
  onChange,
}: {
  filter: IFilterSet | null;
  onChange: (filter: IFilterSet | null) => void;
}) => {
  const fields = useFields({ withHidden: true, withDenied: true });

  const viewId = useViewId();
  const tableId = useTableId();
  const permission = useTablePermission();
  const viewFilterLinkContext = useViewFilterLinkContext(tableId, viewId, {
    disabled: !permission['view|update'],
  });

  return (
    <BaseViewFilter
      value={filter}
      onChange={onChange}
      fields={fields}
      viewFilterLinkContext={viewFilterLinkContext}
    />
  );
};

import {
  FieldType,
  analyzeFilterValidationIssues,
  type IFilter,
  type IFilterValidationFieldMeta,
} from '@teable/core';
import { Popover, PopoverTrigger, PopoverContent, cn } from '@teable/ui-lib';
import { useMemo, useState } from 'react';
import { useFields, useTableId, useViewId } from '../../../hooks';
import { ReadOnlyTip } from '../../ReadOnlyTip';
import type { IFilterBaseComponent } from '../types';
import { BaseViewFilter } from './BaseViewFilter';
import {
  FilterValidationContext,
  useFilterNode,
  useLocalFilterSync,
  useViewFilterLinkContext,
} from './hooks';
import type { IViewFilterConditionItem, IViewFilterLinkContext } from './types';

export interface IViewFilterProps {
  filters: IFilter;
  contentHeader?: React.ReactNode;
  onChange: (value: IFilter) => void;
  viewFilterLinkContext?: IViewFilterLinkContext;
  children?: (text: string, isActive?: boolean, hasWarning?: boolean) => React.ReactNode;
  customValueComponent?: IFilterBaseComponent<IViewFilterConditionItem>;
}

export const ViewFilter = (props: IViewFilterProps) => {
  const { contentHeader, filters, children, onChange } = props;
  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = defaultFields.filter((f) => f.type !== FieldType.Button);
  const { text, isActive, hasWarning } = useFilterNode(filters, fields);
  const viewId = useViewId();
  const tableId = useTableId();
  const [filter, onChangeHandler] = useLocalFilterSync(filters, onChange, viewId);

  // Validation errors against the local (editing) filter — lets the popover highlight
  // invalid rows in real time as the user fixes them.
  const validationErrors = useMemo(() => {
    const fieldMetaMap = fields.reduce<Record<string, IFilterValidationFieldMeta>>((acc, f) => {
      acc[f.id] = {
        type: f.type as FieldType,
        cellValueType: f.cellValueType,
        isMultipleCellValue: f.isMultipleCellValue,
      };
      return acc;
    }, {});
    return analyzeFilterValidationIssues(filter, fieldMetaMap);
  }, [filter, fields]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const viewFilterLinkContext = useViewFilterLinkContext(tableId, viewId, {
    disabled: Boolean('viewFilterLinkContext' in props),
  });
  const finalViewFilterLinkContext = props.viewFilterLinkContext || viewFilterLinkContext;

  return (
    <FilterValidationContext.Provider value={validationErrors}>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          {children?.(text, isActive || popoverOpen, hasWarning)}
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className={cn(
            'flex max-h-96 w-min min-w-[498px] max-w-screen-md flex-col overflow-hidden rounded-lg p-4 pr-2 relative'
          )}
        >
          <ReadOnlyTip />
          {contentHeader}
          <BaseViewFilter<IViewFilterConditionItem>
            fields={fields}
            value={filter}
            onChange={onChangeHandler}
            customValueComponent={props.customValueComponent}
            viewFilterLinkContext={finalViewFilterLinkContext}
          />
        </PopoverContent>
      </Popover>
    </FilterValidationContext.Provider>
  );
};

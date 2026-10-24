import type { IFilterBaseComponent } from '../../../filter';
import { useCrud } from '../../../filter/hooks';
import { ContextColumnSelector } from '../../common/ContextColumnSelector';
import { useAllColumns } from '../../common/useAllColumns';
import type { IBaseFilterItem } from './types';
import { getColumnFilterOperators } from './utils';

export const FieldComponent: IFilterBaseComponent<IBaseFilterItem> = (props) => {
  const { path, value, item } = props;
  const { onChange } = useCrud();
  const columns = useAllColumns();

  return (
    <div>
      <ContextColumnSelector
        value={value}
        onChange={(value, type) => {
          if (value === item.field && type === item.type) {
            return;
          }
          const parentPath = path.slice(0, -1);
          const field = columns.find((column) => column.column === value)?.fieldSource;
          const operators = getColumnFilterOperators(type, field);
          // change the column, meanwhile, reset the operator and value
          onChange(parentPath, {
            field: value,
            type,
            operator: operators[0] || null,
            value: null,
          });
        }}
      />
    </div>
  );
};

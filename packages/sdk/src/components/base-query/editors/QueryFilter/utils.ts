import type { IOperator } from '@teable/core';
import { CellValueType, FieldType, getValidFilterOperators } from '@teable/core';
import { BaseQueryColumnType } from '@teable/openapi';

type IFilterOperatorField = Parameters<typeof getValidFilterOperators>[0];

export const getColumnFilterOperators = (
  columnType: BaseQueryColumnType | undefined,
  field: IFilterOperatorField | undefined
): IOperator[] => {
  if (columnType === BaseQueryColumnType.Field) {
    return field ? getValidFilterOperators(field) : [];
  }
  if (columnType === BaseQueryColumnType.Aggregation) {
    return getValidFilterOperators({
      cellValueType: CellValueType.Number,
      type: FieldType.Number,
    });
  }
  return [];
};

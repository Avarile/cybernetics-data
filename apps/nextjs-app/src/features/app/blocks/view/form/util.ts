import type { IFieldInstance } from '@cybernetics/sdk/model';

export const generateUniqLocalKey = (tableId?: string, viewId?: string) => `${tableId}-${viewId}`;

export const isProtectedField = (field: IFieldInstance) => {
  const { options, notNull } = field;
  const defaultValue = (options as { defaultValue?: string })?.defaultValue;
  return Boolean(notNull) && !defaultValue;
};

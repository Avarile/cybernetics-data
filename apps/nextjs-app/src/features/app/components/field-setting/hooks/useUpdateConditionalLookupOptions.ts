import type { IFieldInstance } from '@cybernetics/sdk/model';
import type { IConditionalLookupOptions } from '@teable/core';
import { isConditionalLookupOptions, safeParseOptions } from '@teable/core';
import { useCallback } from 'react';
import type { IFieldEditorRo } from '../type';

export function useUpdateConditionalLookupOptions(
  field: IFieldEditorRo,
  setFieldFn: (field: IFieldEditorRo) => void
) {
  return useCallback(
    (partial: Partial<IConditionalLookupOptions>, lookupField?: IFieldInstance) => {
      const existing = isConditionalLookupOptions(field.lookupOptions)
        ? field.lookupOptions
        : undefined;

      const nextLookupOptions: IConditionalLookupOptions = {
        ...existing,
        ...(partial || {}),
      } as IConditionalLookupOptions;

      const nextField: IFieldEditorRo = {
        ...field,
        lookupOptions: nextLookupOptions,
        // Conditional lookups always return multiple values (filtered set of records).
        isMultipleCellValue: true,
      };

      if (lookupField) {
        nextField.type = lookupField.type;
        nextField.cellValueType = lookupField.cellValueType;

        const optionsResult = safeParseOptions(lookupField.type, lookupField.options);
        if (optionsResult.success) {
          nextField.options = optionsResult.data;
        }
      }

      setFieldFn(nextField);
    },
    [field, setFieldFn]
  );
}

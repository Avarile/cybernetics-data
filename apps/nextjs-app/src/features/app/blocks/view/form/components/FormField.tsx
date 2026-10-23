import { useFieldStaticGetter, useView } from '@cybernetics/sdk/hooks';
import type { FormView, IFieldInstance } from '@cybernetics/sdk/model';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { isProtectedField } from '../util';
import { FormCellEditor } from './FormCellEditor';

interface IFormFieldEditorProps {
  field: IFieldInstance;
  value: unknown;
  errors: Set<string>;
  onChange: (value: unknown) => void;
}

export const FormField: FC<IFormFieldEditorProps> = (props) => {
  const { field, value, errors, onChange } = props;
  const view = useView() as FormView | undefined;
  const activeViewId = view?.id;
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  if (!activeViewId || !view) return null;

  const { id: fieldId, type, name, description, isLookup, aiConfig } = field;
  const Icon = getFieldStatic(type, {
    isLookup,
    isConditionalLookup: field.isConditionalLookup,
    hasAiConfig: Boolean(aiConfig),
  }).Icon;

  const isProtected = isProtectedField(field);
  const required = isProtected || view?.columnMeta[fieldId]?.required;
  const isError = errors.has(fieldId);

  return (
    <div className="relative w-full py-4" id={`form-field-${fieldId}`}>
      <div className="mb-2 flex w-full items-center gap-1.5 overflow-hidden">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="text-sm font-medium leading-snug">{name}</div>
        {required && <span className="text-xs text-destructive">*</span>}
      </div>

      {description && (
        <div className="mb-2 whitespace-pre-line text-xs leading-normal text-muted-foreground">
          {description}
        </div>
      )}

      <FormCellEditor
        cellValue={value}
        field={field}
        onChange={onChange}
        className={isError ? 'border-destructive focus-visible:ring-transparent' : ''}
      />

      {isError && <div className="mt-1 text-xs text-destructive">{t('required')}</div>}
    </div>
  );
};

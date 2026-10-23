import { LocalStorageKeys } from '@cybernetics/sdk/config';
import { useFields, useTableId, useView } from '@cybernetics/sdk/hooks';
import { type FormView } from '@cybernetics/sdk/model';
import { Loader2 } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { omit } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useLocalStorage, useMap, useSet } from 'react-use';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { tableConfig } from '@/features/i18n/table.config';
import { generateUniqLocalKey } from '../util';
import { FormField } from './FormField';

interface IFormBodyProps {
  className?: string;
  submit?: (fields: Record<string, unknown>) => Promise<void>;
}

export const FormBody = (props: IFormBodyProps) => {
  const { className, submit } = props;
  const tableId = useTableId();
  const view = useView() as FormView | undefined;
  const fields = useFields();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const localKey = generateUniqLocalKey(tableId, view?.id);
  const [formDataMap, setFormDataMap] = useLocalStorage<Record<string, Record<string, unknown>>>(
    LocalStorageKeys.ViewFromData,
    {}
  );
  // Always initialize with {} so server and client first renders match (avoids hydration mismatch
  // from localStorage values causing different DOM structures in rich editors like attachments/links)
  const [formData, { set: setFormData, setAll: initFormData, remove: removeFormData }] = useMap<
    Record<string, unknown>
  >({});

  // Restore saved data from localStorage after hydration completes
  useEffect(() => {
    const saved = formDataMap?.[localKey];
    if (saved && Object.keys(saved).length > 0) {
      initFormData(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [errors, { add: addError, remove: removeError, reset: resetErrors }] = useSet<string>(
    new Set([])
  );
  const [loading, setLoading] = useState(false);
  const previewUrl = usePreviewUrl();

  const visibleFields = useMemo(
    () => fields.filter(({ isComputed, isLookup }) => !isComputed && !isLookup),
    [fields]
  );

  if (view == null) return null;

  const { name, description, columnMeta } = view;

  const onChange = (fieldId: string, value: unknown) => {
    if (errors.has(fieldId) && value != null && value != '') {
      removeError(fieldId);
    }

    if (value == null) {
      removeFormData(fieldId);
      return setTimeout(() =>
        setFormDataMap({ ...formDataMap, [localKey]: omit(formData, fieldId) })
      );
    }

    setFormData(fieldId, value);

    setTimeout(() =>
      setFormDataMap({
        ...formDataMap,
        [localKey]: {
          ...formData,
          [fieldId]: value,
        },
      })
    );
  };

  const onVerify = () => {
    resetErrors();

    const requiredFieldIds = visibleFields.reduce((acc, field) => {
      if (field.notNull || columnMeta[field.id].required) acc.push(field.id);
      return acc;
    }, [] as string[]);

    if (!requiredFieldIds.length) return true;

    let firstErrorFieldId = '';

    requiredFieldIds.forEach((fieldId) => {
      if (formData[fieldId] != null) return;
      if (!firstErrorFieldId) firstErrorFieldId = fieldId;
      addError(fieldId);
    });

    if (!firstErrorFieldId) return true;

    document
      .getElementById(`form-field-${firstErrorFieldId}`)
      ?.scrollIntoView({ behavior: 'smooth' });
    return false;
  };

  const onReset = () => {
    setLoading(false);
    initFormData({});
    setFormDataMap(omit(formDataMap, [localKey]));
  };

  const onSubmit = async () => {
    if (!onVerify()) return;

    setLoading(true);
    if (submit) {
      const finalData = visibleFields.reduce(
        (acc, field) => {
          acc[field.id] = formData[field.id];
          return acc;
        },
        {} as Record<string, unknown>
      );
      await submit(finalData);
      setTimeout(() => {
        onReset();
        toast.success(t('actions.submitSucceed'));
      }, 1000);
    }
  };

  const { coverUrl, logoUrl, submitLabel } = view?.options ?? {};

  return (
    <div className={className}>
      <div
        className={cn(
          'relative h-44 w-full',
          !coverUrl &&
            'bg-gradient-to-tr from-green-400 via-blue-400 to-blue-600 dark:from-green-600 dark:via-blue-600 dark:to-blue-900'
        )}
      >
        {coverUrl && (
          <img
            src={previewUrl(coverUrl)}
            alt="cover"
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </div>

      {logoUrl && (
        <div className="absolute left-8 top-[132px] size-[68px]">
          <img
            className="size-full rounded-xl object-cover shadow-lg ring-4 ring-background"
            src={previewUrl(logoUrl)}
            alt="logo"
          />
        </div>
      )}

      <div
        className={cn(
          'w-full px-8 text-2xl font-semibold tracking-tight',
          logoUrl ? 'pb-2 pt-24' : 'pb-2 pt-8'
        )}
        style={{ overflowWrap: 'break-word' }}
      >
        {name ?? t('untitled')}
      </div>

      {description && (
        <div className="mb-6 w-full whitespace-pre-line px-8 text-sm leading-relaxed text-muted-foreground">
          {description}
        </div>
      )}

      {Boolean(visibleFields.length) && (
        <div className="w-full px-8 pb-10">
          <div className="mb-8 h-px bg-border" />
          {visibleFields.map((field) => {
            const { id: fieldId } = field;
            return (
              <FormField
                key={fieldId}
                field={field}
                value={formData[fieldId] ?? null}
                errors={errors}
                onChange={(value) => onChange(fieldId, value)}
              />
            );
          })}
          <div className="mt-8">
            <Button
              className="w-full text-base font-medium"
              size="lg"
              onClick={onSubmit}
              disabled={loading || !submit}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {submitLabel || t('common:actions.submit')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

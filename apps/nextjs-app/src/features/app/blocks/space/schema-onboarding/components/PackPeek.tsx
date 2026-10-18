import type { FieldType } from '@teable/core';
import { useFieldStaticGetter } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

/** The mixin every non-finance table carries; listed as one line, not five rows. */
export const STANDARD_FIELD_KEYS = new Set([
  'created_at',
  'updated_at',
  'deleted_at',
  'is_active',
  'id',
]);

export interface IPeekField {
  key: string;
  name: string;
  type: FieldType;
  isLookup?: boolean;
  /** Set when the field only exists because another pack is installed too. */
  badge?: string;
}

export const FieldRows = ({ fields }: { fields: IPeekField[] }) => {
  const { t } = useTranslation('onboarding');
  const getStatic = useFieldStaticGetter();
  const shown = fields.filter((f) => !STANDARD_FIELD_KEYS.has(f.key));
  const standard = fields.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((field) => {
        const { Icon } = getStatic(field.type, { isLookup: field.isLookup });
        return (
          <span
            key={field.key}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs',
              field.badge && 'border-dashed'
            )}
          >
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            {field.name}
            {field.badge && (
              <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {field.badge}
              </span>
            )}
          </span>
        );
      })}
      {standard > 0 && (
        <span className="px-1.5 py-0.5 text-xs text-muted-foreground">
          {t('review.standardFields', { count: standard })}
        </span>
      )}
    </div>
  );
};

export const PackPeek = ({
  tables,
}: {
  tables: { key: string; name: string; icon?: string; optional: boolean; fields: IPeekField[] }[];
}) => {
  const { t } = useTranslation('onboarding');
  return (
    <div className="mt-4 space-y-5">
      {tables.map((table) => (
        <section key={table.key}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <span aria-hidden>{table.icon}</span>
            {table.name}
            {table.optional && (
              <span className="text-xs font-normal text-muted-foreground">
                {t('choose.optional')}
              </span>
            )}
          </h3>
          <FieldRows fields={table.fields} />
        </section>
      ))}
    </div>
  );
};

import { useTranslation } from 'next-i18next';
import type { IPeekField } from './FieldRows';
import { FieldRows } from './FieldRows';

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

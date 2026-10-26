import type { ISchemaPackCatalogTable, SchemaPackId } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { Check } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { PACK_THEME, RECOMMENDED_PACKS } from '../packTheme';

export interface IPackCardProps {
  id: SchemaPackId;
  tables: ISchemaPackCatalogTable[];
  selected: boolean;
  /** Its contents are shown in the rail. */
  active?: boolean;
  index: number;
  onToggle: () => void;
  /** Pointer or focus on the card: the rail shows its contents, and keeps them after it leaves. */
  onActivate?: () => void;
}

export const PackCard = (props: IPackCardProps) => {
  const { id, tables, selected, active, index, onToggle, onActivate } = props;
  const { t } = useTranslation('onboarding');
  const theme = PACK_THEME[id];
  const core = tables.filter((table) => !table.optional);

  return (
    <div
      onMouseEnter={onActivate}
      onFocus={onActivate}
      className={cn(
        'group relative flex flex-col rounded-2xl border bg-card p-5 text-left transition-colors duration-150',
        'hover:border-foreground/25 motion-reduce:transition-none',
        'animate-in fade-in slide-in-from-bottom-2 fill-mode-both motion-reduce:animate-none',
        selected && theme.selected,
        active && !selected && 'border-foreground/25'
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={t(`packs.${id}.title`)}
        onClick={onToggle}
        className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <div className="pointer-events-none flex items-start justify-between gap-2">
        <span className={cn('flex size-10 items-center justify-center rounded-full', theme.bubble)}>
          <theme.Icon className="size-5" />
        </span>
        <div className="flex items-center gap-2">
          {RECOMMENDED_PACKS.includes(id) && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t('choose.recommended')}
            </span>
          )}
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full border transition-colors',
              selected
                ? cn(theme.dot, 'border-transparent text-white')
                : 'border-muted-foreground/30'
            )}
          >
            {selected && <Check className="size-3.5" strokeWidth={3} />}
          </span>
        </div>
      </div>
      <h3 className="pointer-events-none mt-4 text-base font-semibold">{t(`packs.${id}.title`)}</h3>
      <p className="pointer-events-none mt-1 text-sm text-muted-foreground">
        {t(`packs.${id}.promise`)}
      </p>
      <div className="pointer-events-none mt-4 flex flex-1 flex-wrap content-start gap-1.5">
        {core.map((table) => (
          <span
            key={table.key}
            className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            {table.name.replace(/^finance_/, '')}
          </span>
        ))}
      </div>
    </div>
  );
};

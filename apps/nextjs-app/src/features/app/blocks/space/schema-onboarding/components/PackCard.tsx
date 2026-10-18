import type { ISchemaPackCatalogTable, SchemaPackId } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { Check } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { PACK_THEME } from '../packTheme';

export interface IPackCardProps {
  id: SchemaPackId;
  tables: ISchemaPackCatalogTable[];
  selected: boolean;
  index: number;
  onToggle: () => void;
  onPeek: () => void;
}

export const PackCard = (props: IPackCardProps) => {
  const { id, tables, selected, index, onToggle, onPeek } = props;
  const { t } = useTranslation('onboarding');
  const theme = PACK_THEME[id];
  const core = tables.filter((table) => !table.optional);

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-2xl border bg-card p-5 text-left shadow-sm transition-all duration-150',
        'hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        'animate-in fade-in slide-in-from-bottom-2 fill-mode-both motion-reduce:animate-none',
        selected && theme.selected
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
      <div className="pointer-events-none flex items-start justify-between">
        <span className={cn('flex size-11 items-center justify-center rounded-full', theme.bubble)}>
          <theme.Icon className="size-5" />
        </span>
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full border transition-colors',
            selected ? cn(theme.dot, 'border-transparent text-white') : 'border-muted-foreground/30'
          )}
        >
          {selected && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      </div>
      <h3 className="pointer-events-none mt-4 text-base font-semibold">
        {t(`packs.${id}.title`)}
        <kbd className="ml-2 hidden rounded border px-1 text-[10px] font-normal text-muted-foreground sm:inline">
          {index + 1}
        </kbd>
      </h3>
      <p className="pointer-events-none mt-1 text-sm text-muted-foreground">
        {t(`packs.${id}.promise`)}
      </p>
      <div className="pointer-events-none mt-3 flex flex-wrap gap-1.5">
        {core.map((table) => (
          <span
            key={table.key}
            className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            {table.name.replace(/^finance_/, '')}
          </span>
        ))}
      </div>
      <ul className="pointer-events-none mt-3 space-y-1 text-sm">
        {(['bullet1', 'bullet2', 'bullet3'] as const).map((bullet) => (
          <li key={bullet} className="flex items-center gap-2">
            <Check className="size-3.5 shrink-0 text-muted-foreground" />
            {t(`packs.${id}.${bullet}`)}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onPeek}
        className="relative mt-4 self-start text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('choose.peek')}
      </button>
    </div>
  );
};

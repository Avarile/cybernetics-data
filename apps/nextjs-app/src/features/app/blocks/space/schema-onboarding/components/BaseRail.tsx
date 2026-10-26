import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { Check, Plus } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { PACK_THEME } from '../packTheme';
import { PackPeek } from './PackPeek';

/** "11 tables from Progress + People", or the empty prompt: the footer summary. */
export const useSelectionSummary = (
  catalog: ISchemaPackCatalogVo,
  packs: SchemaPackId[],
  optionalTables: string[]
) => {
  const { t } = useTranslation('onboarding');
  if (!packs.length) return t('choose.previewEmpty');
  const tables = catalog.packs
    .filter((p) => packs.includes(p.id))
    .flatMap((p) => p.tables)
    .filter((tb) => !tb.optional || optionalTables.includes(tb.key)).length;
  return t('choose.previewCount', {
    tables,
    packs: packs.map((p) => t(`packs.${p}.name`)).join(' + '),
  });
};

export interface IBaseRailProps {
  catalog: ISchemaPackCatalogVo;
  packs: SchemaPackId[];
  /** The pack whose contents are shown; the first pack when unset. */
  active?: SchemaPackId;
  onSelect: (pack: SchemaPackId) => void;
  onToggle: (pack: SchemaPackId) => void;
}

/** What's inside one pack, beside every step before the build; the strip on top switches packs. */
export const BaseRail = (props: IBaseRailProps) => {
  const { catalog, packs, active, onSelect, onToggle } = props;
  const { t } = useTranslation('onboarding');
  const pack = catalog.packs.find((p) => p.id === active) ?? catalog.packs[0];
  if (!pack) return null;
  const theme = PACK_THEME[pack.id];
  const name = t(`packs.${pack.id}.name`);
  const selected = packs.includes(pack.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5">
        {catalog.packs.map(({ id }) => {
          const { Icon, bubble, dot } = PACK_THEME[id];
          return (
            <button
              key={id}
              type="button"
              aria-pressed={id === pack.id}
              aria-label={t(`packs.${id}.name`)}
              title={t(`packs.${id}.name`)}
              onClick={() => onSelect(id)}
              className={cn(
                'relative flex h-8 flex-1 items-center justify-center rounded-md border transition-colors',
                id === pack.id ? 'border-foreground/25 bg-background' : 'border-transparent',
                'hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
            >
              <span className={cn('flex size-6 items-center justify-center rounded-full', bubble)}>
                <Icon className="size-3.5" />
              </span>
              {packs.includes(id) && (
                <span className={cn('absolute right-1 top-1 size-1.5 rounded-full', dot)} />
              )}
            </button>
          );
        })}
      </div>
      <div
        key={pack.id}
        className="flex flex-col gap-4 duration-150 animate-in fade-in motion-reduce:animate-none"
      >
        <div className="flex items-center gap-2">
          <span
            className={cn('flex size-7 items-center justify-center rounded-full', theme.bubble)}
          >
            <theme.Icon className="size-3.5" />
          </span>
          <h2 className="truncate text-sm font-medium">{t('choose.peekTitle', { pack: name })}</h2>
        </div>
        <ul className="space-y-1.5 text-sm">
          {(['bullet1', 'bullet2', 'bullet3'] as const).map((bullet) => (
            <li key={bullet} className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              {t(`packs.${pack.id}.${bullet}`)}
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          variant={selected ? 'outline' : 'default'}
          className="gap-1.5"
          onClick={() => onToggle(pack.id)}
        >
          {selected ? (
            t('choose.removePack', { pack: name })
          ) : (
            <>
              <Plus className="size-3.5" />
              {t('choose.addPack', { pack: name })}
            </>
          )}
        </Button>
        <PackPeek tables={pack.tables} />
      </div>
    </div>
  );
};

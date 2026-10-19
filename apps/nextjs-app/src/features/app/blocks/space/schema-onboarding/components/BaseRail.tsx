import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { PACK_THEME } from '../packTheme';
import { PackPeek } from './PackPeek';
import { SchemaPreview } from './SchemaPreview';

/** Bridges with exactly one side picked: the "add X to get Y" nudges. */
export const pendingBridges = (catalog: ISchemaPackCatalogVo, packs: SchemaPackId[]) =>
  catalog.bridges
    .filter((b) => b.packs.filter((p) => packs.includes(p)).length === 1)
    .map((b) => ({
      key: b.packs.join('+') as 'progress+people' | 'progress+knowledge',
      missing: b.packs.find((p) => !packs.includes(p))!,
    }));

/** "11 tables from Progress + People", or the empty prompt: the rail caption and footer summary. */
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
  optionalTables: string[];
  onToggle: (pack: SchemaPackId) => void;
  /** Show this pack's details in place of the map. */
  peek?: SchemaPackId | null;
  onClosePeek?: () => void;
  /** A hovered card: its tables light up on the map. */
  highlight?: SchemaPackId | null;
}

/** The base taking shape beside every step before the build, or one pack's details. */
export const BaseRail = (props: IBaseRailProps) => {
  const { catalog, packs, optionalTables, onToggle, peek, onClosePeek, highlight } = props;
  const pack = peek && catalog.packs.find((p) => p.id === peek);
  return pack ? (
    <PeekView
      pack={pack}
      selected={packs.includes(pack.id)}
      onToggle={() => onToggle(pack.id)}
      onClose={onClosePeek}
    />
  ) : (
    <MapView
      catalog={catalog}
      packs={packs}
      optionalTables={optionalTables}
      onToggle={onToggle}
      highlight={highlight}
    />
  );
};

const MapView = (props: Omit<IBaseRailProps, 'peek' | 'onClosePeek'>) => {
  const { catalog, packs, optionalTables, onToggle, highlight } = props;
  const { t } = useTranslation('onboarding');
  const nudges = useMemo(() => pendingBridges(catalog, packs), [catalog, packs]);
  const summary = useSelectionSummary(catalog, packs, optionalTables);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{t('choose.preview')}</h2>
      <SchemaPreview
        catalog={catalog}
        packs={packs}
        optionalTables={optionalTables}
        highlight={highlight}
      />
      <p className="text-center text-xs text-muted-foreground">{summary}</p>
      {nudges.map(({ key, missing }) => {
        const theme = PACK_THEME[missing];
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(missing)}
            className={cn(
              'flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-xs transition-colors',
              theme.nudge
            )}
          >
            <theme.Icon className="size-3.5 shrink-0" />
            <span className="flex-1">
              {t('choose.nudge', {
                pack: t(`packs.${missing}.name`),
                benefit: t(`bridges.${key}`),
              })}
            </span>
            <Plus className="size-3.5 shrink-0" />
          </button>
        );
      })}
    </div>
  );
};

const PeekView = (props: {
  pack: ISchemaPackCatalogVo['packs'][number];
  selected: boolean;
  onToggle: () => void;
  onClose?: () => void;
}) => {
  const { pack, selected, onToggle, onClose } = props;
  const { t } = useTranslation('onboarding');
  const theme = PACK_THEME[pack.id];
  const name = t(`packs.${pack.id}.name`);

  return (
    <div className="flex flex-col gap-4 duration-150 animate-in fade-in slide-in-from-right-2 motion-reduce:animate-none">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t('back')}
          onClick={onClose}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <span className={cn('flex size-7 items-center justify-center rounded-full', theme.bubble)}>
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
        onClick={onToggle}
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
  );
};

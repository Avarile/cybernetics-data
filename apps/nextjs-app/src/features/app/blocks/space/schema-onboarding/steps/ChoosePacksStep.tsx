import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@teable/ui-lib/shadcn';
import { Plus } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { PackCard } from '../components/PackCard';
import { PackPeek } from '../components/PackPeek';
import { SchemaPreview } from '../components/SchemaPreview';

export interface IChoosePacksStepProps {
  catalog: ISchemaPackCatalogVo;
  packs: SchemaPackId[];
  optionalTables: string[];
  onToggle: (pack: SchemaPackId) => void;
  onSelectAll: () => void;
  onContinue: () => void;
}

/** Bridges with exactly one side picked: the "add X to get Y" nudges. */
export const pendingBridges = (catalog: ISchemaPackCatalogVo, packs: SchemaPackId[]) =>
  catalog.bridges
    .filter((b) => b.packs.filter((p) => packs.includes(p)).length === 1)
    .map((b) => ({
      key: b.packs.join('+') as 'progress+people' | 'progress+knowledge',
      missing: b.packs.find((p) => !packs.includes(p))!,
    }));

export const ChoosePacksStep = (props: IChoosePacksStepProps) => {
  const { catalog, packs, optionalTables, onToggle, onSelectAll, onContinue } = props;
  const { t } = useTranslation('onboarding');
  const [peek, setPeek] = useState<SchemaPackId | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    // The wizard itself may sit in a dialog, so only its own sheets switch the shortcuts off.
    if (peek || mapOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const index = Number(e.key) - 1;
      const pack = catalog.packs[index];
      if (pack && !e.metaKey && !e.ctrlKey && !e.altKey) onToggle(pack.id);
      if (e.key === 'Enter' && packs.length && target?.tagName !== 'BUTTON') onContinue();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [catalog.packs, packs.length, onToggle, onContinue, peek, mapOpen]);

  const nudges = useMemo(() => pendingBridges(catalog, packs), [catalog, packs]);
  const packNames = packs.map((p) => t(`packs.${p}.name`)).join(' + ');
  const tableCount = catalog.packs
    .filter((p) => packs.includes(p.id))
    .flatMap((p) => p.tables)
    .filter((tb) => !tb.optional || optionalTables.includes(tb.key)).length;

  const preview = (
    <div className="flex flex-col gap-3">
      <SchemaPreview catalog={catalog} packs={packs} optionalTables={optionalTables} />
      <p className="text-center text-xs text-muted-foreground">
        {packs.length
          ? t('choose.previewCount', { tables: tableCount, packs: packNames })
          : t('choose.previewEmpty')}
      </p>
      {nudges.map(({ key, missing }) => (
        <button
          key={key}
          type="button"
          onClick={() => onToggle(missing)}
          className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-xs hover:bg-muted"
        >
          {t('choose.nudge', {
            pack: t(`packs.${missing}.name`),
            benefit: t(`bridges.${key}`),
          })}
          <Plus className="size-3.5 shrink-0" />
        </button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6 lg:flex-row lg:items-start">
      <div className="flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('choose.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('choose.subtitle')}{' '}
          <span className="font-medium text-foreground">{t('choose.recommended')}</span>
        </p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {catalog.packs.map((pack, index) => (
            <PackCard
              key={pack.id}
              id={pack.id}
              tables={pack.tables}
              index={index}
              selected={packs.includes(pack.id)}
              onToggle={() => onToggle(pack.id)}
              onPeek={() => setPeek(pack.id)}
            />
          ))}
        </div>
        <div className="sticky bottom-0 z-10 -mx-2 mt-6 hidden items-center justify-between gap-4 rounded-xl bg-background/80 px-2 py-3 backdrop-blur lg:flex">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onSelectAll}>
              {t('choose.selectAll')}
            </Button>
            <span className="hidden text-xs text-muted-foreground md:inline">
              {t('choose.keyboardHint')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {!packs.length && (
              <span className="text-xs text-muted-foreground">{t('choose.pickOne')}</span>
            )}
            <Button onClick={onContinue} disabled={!packs.length}>
              {t('continue')}
            </Button>
          </div>
        </div>
      </div>

      <aside className="sticky top-6 hidden w-80 shrink-0 rounded-2xl border bg-card/80 p-4 backdrop-blur lg:block">
        <h2 className="mb-2 text-sm font-medium">{t('choose.preview')}</h2>
        {preview}
      </aside>

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <Button className="mb-2 w-full" onClick={onContinue} disabled={!packs.length}>
          {t('continue')}
        </Button>
        <Button variant="outline" className="w-full" onClick={() => setMapOpen(true)}>
          {packs.length
            ? t('choose.previewCount', { tables: tableCount, packs: packNames })
            : t('choose.previewEmpty')}{' '}
          · {t('choose.viewMap')}
        </Button>
      </div>

      <Sheet open={mapOpen} onOpenChange={setMapOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t('choose.preview')}</SheetTitle>
          </SheetHeader>
          {preview}
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(peek)} onOpenChange={(open) => !open && setPeek(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {peek && (
            <>
              <SheetHeader>
                <SheetTitle>{t('choose.peekTitle', { pack: t(`packs.${peek}.name`) })}</SheetTitle>
              </SheetHeader>
              <PackPeek tables={catalog.packs.find((p) => p.id === peek)!.tables} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

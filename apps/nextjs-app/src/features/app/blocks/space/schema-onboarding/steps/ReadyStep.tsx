import type { ISchemaPackInstallVo, SchemaPackId } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { ArrowRight, CheckCircle2, Database, Network } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { PACK_ENTRY_TABLE, PACK_THEME } from '../packTheme';

export interface IReadyStepProps {
  packs: SchemaPackId[];
  result: ISchemaPackInstallVo;
  /** The packs went into an existing base, so only some tables are new. */
  addedToBase?: boolean;
  /** Dialog mode: close the wizard, from the Done button or on the way into the base. */
  onDone?: () => void;
}

export const ReadyStep = ({ packs, result, addedToBase, onDone }: IReadyStepProps) => {
  const { t } = useTranslation('onboarding');
  const entries = packs
    .map((pack) => ({ pack, table: result.tables.find((tb) => tb.key === PACK_ENTRY_TABLE[pack]) }))
    .filter((e) => e.table);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 py-6 text-center">
      <CheckCircle2 className="size-14 text-emerald-500 duration-300 animate-in zoom-in-50 motion-reduce:animate-none" />
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{t('ready.title')}</h1>
      <p className="mt-2 text-muted-foreground">
        {addedToBase
          ? t('ready.addedSubtitle', { tables: result.counts.tables, fields: result.counts.fields })
          : t('ready.subtitle', { count: result.counts.tables })}
      </p>
      <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ pack, table }) => {
          const theme = PACK_THEME[pack];
          return (
            <Link
              key={pack}
              href={`/base/${result.baseId}/${table!.id}`}
              onClick={onDone}
              className="group flex items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-shadow hover:shadow-md"
            >
              <span
                className={cn(
                  'flex size-10 items-center justify-center rounded-full',
                  theme.bubble
                )}
              >
                <theme.Icon className="size-5" />
              </span>
              <span className="flex-1">
                <span className="block text-xs text-muted-foreground">
                  {t(`packs.${pack}.name`)}
                </span>
                <span className="block text-sm font-medium">
                  {t('ready.open', { table: table!.name.replace(/^finance_/, '') })}
                </span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          );
        })}
        {/* Every pack may have gone into tables that already existed: there is still a way in. */}
        {!entries.length && (
          <Link
            href={`/base/${result.baseId}`}
            onClick={onDone}
            className="group flex items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-shadow hover:shadow-md"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-muted">
              <Database className="size-5" />
            </span>
            <span className="flex-1 text-sm font-medium">{t('ready.openBase')}</span>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
        {packs.length > 1 && (
          <Link
            href={`/base/${result.baseId}/graph`}
            onClick={onDone}
            className="group flex items-center gap-3 rounded-2xl border border-dashed p-4 text-left hover:bg-muted"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-muted">
              <Network className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium">{t('ready.graph')}</span>
              <span className="block text-xs text-muted-foreground">{t('ready.graphHint')}</span>
            </span>
          </Link>
        )}
      </div>
      <p className="mt-8 text-xs text-muted-foreground">{t('ready.tip')}</p>
      {onDone && (
        <Button variant="outline" className="mt-4" onClick={onDone}>
          {t('ready.done')}
        </Button>
      )}
    </div>
  );
};

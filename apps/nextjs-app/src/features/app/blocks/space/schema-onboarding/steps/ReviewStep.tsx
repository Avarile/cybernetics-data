import type { ISchemaPackCatalogVo, ISchemaPackPlanVo, SchemaPackId } from '@teable/openapi';
import { SCHEMA_PACK_IDS } from '@teable/openapi';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  cn,
  Skeleton,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { FieldRows } from '../components/FieldRows';
import { PACK_THEME } from '../packTheme';

export interface IReviewStepProps {
  packs: SchemaPackId[];
  plan: ISchemaPackPlanVo | undefined;
  /** For each table's icon; the plan itself only has names. */
  catalog?: ISchemaPackCatalogVo;
  isLoading: boolean;
  isError: boolean;
  /** The server's reason, e.g. a field that already exists with another type. */
  errorMessage?: string;
  onRetry: () => void;
  /** Base name and build options, between the counts and the plan. */
  options?: ReactNode;
}

/**
 * The picked packs, then any other pack whose tables already in the base gain fields
 * (bridge links when a pack is added later), so every change in the plan is on screen.
 */
export const reviewGroups = (packs: SchemaPackId[], plan: ISchemaPackPlanVo | undefined) => {
  const touched = new Set(plan?.tables.map((table) => table.pack));
  const others = SCHEMA_PACK_IDS.filter((id) => !packs.includes(id) && touched.has(id));
  return [
    ...packs.map((pack) => ({ pack, picked: true })),
    ...others.map((pack) => ({ pack, picked: false })),
  ];
};

const Stat = ({ value, label }: { value: number; label: string }) => (
  <div className="rounded-xl border bg-card px-3 py-2">
    <div className="text-xl font-semibold tabular-nums">{value}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
);

type PlanTable = ISchemaPackPlanVo['tables'][number];

const TableRow = ({ table, icon }: { table: PlanTable; icon?: string }) => {
  const { t } = useTranslation('onboarding');
  const bridges = table.fields.filter((field) => field.bridge).length;
  return (
    <AccordionItem value={table.key} className="last:border-b-0">
      <AccordionTrigger className="gap-3 px-4 py-3 hover:bg-muted/50 hover:no-underline">
        <span aria-hidden className="w-5 text-center text-base leading-none">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{table.name}</span>
        {table.existing && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
            {t('review.existing')}
          </span>
        )}
        {!table.existing && bridges > 0 && (
          <span className="rounded-full border border-dashed px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
            {t('review.bridgeCount', { count: bridges })}
          </span>
        )}
        <span className="text-xs font-normal tabular-nums text-muted-foreground">
          {table.existing
            ? t('review.addsFields', { count: table.fields.length })
            : t('review.fields', { count: table.fields.length })}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-4" innerClassName="pb-3 pl-8">
        <FieldRows
          fields={table.fields.map((field) => ({
            ...field,
            badge: field.bridge
              ? t('review.bridge', { pack: t(`packs.${field.bridge}.name`) })
              : undefined,
          }))}
        />
      </AccordionContent>
    </AccordionItem>
  );
};

export const ReviewStep = (props: IReviewStepProps) => {
  const { packs, plan, catalog, isLoading, isError, errorMessage, onRetry, options } = props;
  const { t } = useTranslation('onboarding');
  const groups = reviewGroups(packs, plan);
  const icons = useMemo(
    () => new Map(catalog?.packs.flatMap((p) => p.tables.map((tb) => [tb.key, tb.icon] as const))),
    [catalog]
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('review.title')}</h1>

      {plan && !isError ? (
        <div className="grid grid-cols-3 gap-2" data-testid="plan-counts">
          <Stat value={plan.counts.tables} label={t('review.statTables')} />
          <Stat value={plan.counts.fields} label={t('review.statFields')} />
          <Stat value={plan.counts.links} label={t('review.statLinks')} />
        </div>
      ) : (
        isLoading && <Skeleton className="h-[60px] w-full rounded-xl" />
      )}

      {options}

      {isError && (
        <div className="rounded-2xl border border-destructive/40 p-6 text-sm">
          <p>{t('review.loadError')}</p>
          {errorMessage && (
            <p className="mt-1 break-words text-xs text-muted-foreground">{errorMessage}</p>
          )}
          <Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>
            {t('review.retry')}
          </Button>
        </div>
      )}
      {isLoading && !plan && <Skeleton className="h-72 w-full rounded-2xl" />}

      {plan &&
        !isError &&
        groups.map(({ pack, picked }) => (
          <section key={pack} aria-label={t(`packs.${pack}.name`)}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <span className={cn('size-2 rounded-full', PACK_THEME[pack].dot)} />
              {t(`packs.${pack}.name`)}
              {!picked && (
                <span className="text-xs font-normal text-muted-foreground">
                  {t('review.inBase')}
                </span>
              )}
            </h2>
            {!picked && (
              <p className="mb-2 text-xs text-muted-foreground">
                {t('review.inBaseHint', { pack: t(`packs.${pack}.name`) })}
              </p>
            )}
            <Accordion type="multiple" className="overflow-hidden rounded-2xl border bg-card">
              {plan.tables
                .filter((table) => table.pack === pack)
                .map((table) => (
                  <TableRow key={table.key} table={table} icon={icons.get(table.key)} />
                ))}
            </Accordion>
          </section>
        ))}
    </div>
  );
};

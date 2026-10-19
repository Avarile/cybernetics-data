import type { ISchemaPackPlanVo, SchemaPackId } from '@teable/openapi';
import { SCHEMA_PACK_IDS } from '@teable/openapi';
import {
  Button,
  cn,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { FieldRows } from '../components/FieldRows';
import { PACK_THEME } from '../packTheme';

export interface IReviewStepProps {
  packs: SchemaPackId[];
  plan: ISchemaPackPlanVo | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The server's reason, e.g. a field that already exists with another type. */
  errorMessage?: string;
  onRetry: () => void;
  onBack: () => void;
  onBuild: () => void;
}

/**
 * The picked packs, then any other pack whose tables already in the base gain fields
 * (bridge links when a pack is added later), so every change in the plan is on screen.
 */
export const reviewTabs = (packs: SchemaPackId[], plan: ISchemaPackPlanVo | undefined) => {
  const touched = new Set(plan?.tables.map((table) => table.pack));
  const others = SCHEMA_PACK_IDS.filter((id) => !packs.includes(id) && touched.has(id));
  return [
    ...packs.map((pack) => ({ pack, picked: true })),
    ...others.map((pack) => ({ pack, picked: false })),
  ];
};

export const ReviewStep = (props: IReviewStepProps) => {
  const { packs, plan, isLoading, isError, errorMessage, onRetry, onBack, onBuild } = props;
  const { t } = useTranslation('onboarding');
  const tabs = reviewTabs(packs, plan);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('review.title')}</h1>
        {plan && (
          <p className="text-sm text-muted-foreground" data-testid="plan-counts">
            {t('review.counts', {
              tables: plan.counts.tables,
              fields: plan.counts.fields,
              links: plan.counts.links,
            })}
          </p>
        )}
      </div>

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

      {plan && !isError && (
        <Tabs defaultValue={packs[0]} className="rounded-2xl border bg-card p-4">
          <TabsList className="flex h-auto flex-wrap justify-start">
            {tabs.map(({ pack, picked }) => (
              <TabsTrigger key={pack} value={pack} className="gap-2">
                <span className={cn('size-2 rounded-full', PACK_THEME[pack].dot)} />
                {t(`packs.${pack}.name`)}
                {!picked && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {t('review.inBase')}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map(({ pack, picked }) => (
            <TabsContent key={pack} value={pack} className="mt-4 space-y-4">
              {!picked && (
                <p className="text-xs text-muted-foreground">
                  {t('review.inBaseHint', { pack: t(`packs.${pack}.name`) })}
                </p>
              )}
              {plan.tables
                .filter((table) => table.pack === pack)
                .map((table) => (
                  <section key={table.key} className={cn(table.existing && 'opacity-70')}>
                    <h3 className="mb-2 flex items-baseline justify-between text-sm font-medium">
                      {table.name}
                      <span className="text-xs font-normal text-muted-foreground">
                        {t('review.fields', { count: table.fields.length })}
                      </span>
                    </h3>
                    <FieldRows
                      fields={table.fields.map((field) => ({
                        ...field,
                        badge: field.bridge
                          ? t('review.bridge', { pack: t(`packs.${field.bridge}.name`) })
                          : undefined,
                      }))}
                    />
                  </section>
                ))}
            </TabsContent>
          ))}
        </Tabs>
      )}

      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          {t('back')}
        </Button>
        <Button className="gap-2" onClick={onBuild} disabled={!plan || isError}>
          {t('review.build')}
          <Sparkles className="size-4" />
        </Button>
      </div>
    </div>
  );
};

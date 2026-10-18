import type { ISchemaPackPlanVo, SchemaPackId } from '@teable/openapi';
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
import { FieldRows } from '../components/PackPeek';
import { PACK_THEME } from '../packTheme';

export interface IReviewStepProps {
  packs: SchemaPackId[];
  plan: ISchemaPackPlanVo | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onBack: () => void;
  onBuild: () => void;
}

export const ReviewStep = (props: IReviewStepProps) => {
  const { packs, plan, isLoading, isError, onRetry, onBack, onBuild } = props;
  const { t } = useTranslation('onboarding');

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
          <Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>
            {t('review.retry')}
          </Button>
        </div>
      )}
      {isLoading && !plan && <Skeleton className="h-72 w-full rounded-2xl" />}

      {plan && (
        <Tabs defaultValue={packs[0]} className="rounded-2xl border bg-card p-4">
          <TabsList className="flex h-auto flex-wrap justify-start">
            {packs.map((pack) => (
              <TabsTrigger key={pack} value={pack} className="gap-2">
                <span className={cn('size-2 rounded-full', PACK_THEME[pack].dot)} />
                {t(`packs.${pack}.name`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {packs.map((pack) => (
            <TabsContent key={pack} value={pack} className="mt-4 space-y-4">
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

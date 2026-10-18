import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { SchemaPreview } from '../components/SchemaPreview';

export interface IBuildingStepProps {
  catalog: ISchemaPackCatalogVo;
  packs: SchemaPackId[];
  optionalTables: string[];
  starterRows: boolean;
  /** True once the server confirmed the install. */
  done: boolean;
  error?: string;
  onRetry: () => void;
  onBack: () => void;
}

const SLOW_AFTER_MS = 20_000;

/**
 * The install is one request, so there is no real per-phase progress to show. Phases spin
 * until the server answers; checkmarks only appear after success, never on a timer.
 */
export const BuildingStep = (props: IBuildingStepProps) => {
  const { catalog, packs, optionalTables, starterRows, done, error, onRetry, onBack } = props;
  const { t } = useTranslation('onboarding');
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (done || error) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [done, error]);

  const phases = [
    t('building.tables'),
    t('building.links'),
    t('building.computed'),
    ...(starterRows ? [t('building.seeds')] : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-10 px-4 py-6 md:flex-row">
      <div className="w-full max-w-lg">
        <SchemaPreview
          catalog={catalog}
          packs={packs}
          optionalTables={optionalTables}
          building={!done && !error}
        />
      </div>
      <div className="w-full max-w-xs" aria-live="polite">
        <h1 className="mb-4 text-xl font-semibold">{t('building.title')}</h1>
        <ul className="space-y-3">
          {phases.map((phase, i) => (
            <li
              key={phase}
              className={cn(
                'flex items-center gap-3 text-sm',
                done && 'animate-in fade-in fill-mode-both motion-reduce:animate-none'
              )}
              style={done ? { animationDelay: `${i * 150}ms` } : undefined}
            >
              {done ? (
                <Check className="size-4 text-emerald-500" />
              ) : error ? (
                <span className="size-4 rounded-full border" />
              ) : (
                <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
              )}
              {phase}
            </li>
          ))}
        </ul>
        {slow && !done && !error && (
          <p className="mt-4 text-xs text-muted-foreground">{t('building.slow')}</p>
        )}
        {error && (
          <div className="mt-6 rounded-xl border border-destructive/40 p-4 text-sm">
            <p className="font-medium">{t('building.failed')}</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={onRetry}>
                {t('building.tryAgain')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onBack}>
                {t('building.backToReview')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

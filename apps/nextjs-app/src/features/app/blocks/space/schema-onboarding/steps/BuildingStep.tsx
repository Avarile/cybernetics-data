import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
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
const PHASE_MS = 1_600;

/**
 * The install is one request, so there is no real per-phase progress to show. While it runs,
 * a single line walks through what the server does and holds on the last phase; checkmarks
 * only appear after success, never on a timer.
 */
export const BuildingStep = (props: IBuildingStepProps) => {
  const { catalog, packs, optionalTables, starterRows, done, error, onRetry, onBack } = props;
  const { t } = useTranslation('onboarding');
  const [slow, setSlow] = useState(false);
  const [phase, setPhase] = useState(0);

  const phases = [
    t('building.tables'),
    t('building.links'),
    t('building.computed'),
    ...(starterRows ? [t('building.seeds')] : []),
  ];
  const working = !done && !error;

  useEffect(() => {
    if (!working) return;
    setSlow(false);
    setPhase(0);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    const phaseTimer = setInterval(
      () => setPhase((i) => Math.min(i + 1, phases.length - 1)),
      PHASE_MS
    );
    return () => {
      clearTimeout(slowTimer);
      clearInterval(phaseTimer);
    };
  }, [working, phases.length]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-10 px-4 py-6 md:flex-row">
      <div className="w-full max-w-lg">
        <SchemaPreview
          catalog={catalog}
          packs={packs}
          optionalTables={optionalTables}
          building={working}
        />
      </div>
      <div className="w-full max-w-xs">
        <h1 className="mb-4 text-xl font-semibold">{t('building.title')}</h1>
        {working && (
          <p className="flex items-center gap-3 text-sm">
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
            {/* Keyed so each phase fades in; not live, so screen readers aren't read every tick. */}
            <span
              key={phase}
              className="duration-300 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
            >
              {phases[phase]}
            </span>
          </p>
        )}
        <div aria-live="polite">
          {done && (
            <ul className="space-y-3">
              {phases.map((name, i) => (
                <li
                  key={name}
                  className="flex items-center gap-3 text-sm animate-in fade-in fill-mode-both motion-reduce:animate-none"
                  style={{ animationDelay: `${i * 150}ms` }}
                >
                  <Check className="size-4 text-emerald-500" />
                  {name}
                </li>
              ))}
            </ul>
          )}
          {slow && working && (
            <p className="mt-4 text-xs text-muted-foreground">{t('building.slow')}</p>
          )}
          {error && (
            <div className="rounded-xl border border-destructive/40 p-4 text-sm">
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
    </div>
  );
};

import type { ISchemaPackInstallVo } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import { Button, cn, Skeleton } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  useInstallPlan,
  useInstallSchemaPacks,
  useOptionalOf,
  useSchemaPackCatalog,
} from './hooks';
import type { IWizardState, WizardStep } from './state';
import { createInitialState, restoreState, wizardReducer } from './state';
import { BuildingStep } from './steps/BuildingStep';
import { ChoosePacksStep } from './steps/ChoosePacksStep';
import { PersonaliseStep } from './steps/PersonaliseStep';
import { ReadyStep } from './steps/ReadyStep';
import { ReviewStep } from './steps/ReviewStep';
import { WelcomeStep } from './steps/WelcomeStep';

export interface ISchemaPackWizardProps {
  spaceId: string;
  /** First-run takeover (starts at Welcome, completes onboarding) or the re-entry dialog. */
  mode: 'onboarding' | 'dialog';
  /** Add the packs to this base instead of creating one. */
  baseId?: string;
  /** Dialog mode: close the wizard from the Ready step. */
  onDone?: () => void;
}

const STEPPER: WizardStep[] = ['choose', 'personalise', 'review'];
const storageKey = (spaceId: string) => `schema-onboarding:${spaceId}`;

/** Restores choices after an accidental refresh; never resumes mid-build. */
const restore = (spaceId: string): Partial<IWizardState> => {
  try {
    const raw = sessionStorage.getItem(storageKey(spaceId));
    return raw ? restoreState(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
};

const Stepper = ({ step }: { step: WizardStep }) => {
  const { t } = useTranslation('onboarding');
  const current = STEPPER.indexOf(step);
  if (current < 0) return null;
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="progress">
      {STEPPER.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          {i > 0 && <span className="h-px w-6 bg-border" />}
          <span
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-1.5',
              i <= current ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            <span
              className={cn(
                'size-2 rounded-full',
                i < current
                  ? 'bg-foreground'
                  : i === current
                    ? 'bg-primary ring-4 ring-primary/20'
                    : 'bg-border'
              )}
            />
            <span className="hidden sm:inline">{t(`steps.${s as 'choose'}`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
};

export const SchemaPackWizard = ({ spaceId, mode, baseId, onDone }: ISchemaPackWizardProps) => {
  const { t } = useTranslation('onboarding');
  const { user } = useSession();
  const catalogQuery = useSchemaPackCatalog();
  const catalog = catalogQuery.data;
  const optionalOf = useOptionalOf(catalog);

  const [state, dispatch] = useReducer(wizardReducer, undefined, () =>
    createInitialState({
      baseName: t('personalise.defaultBaseName'),
      step: mode === 'onboarding' ? 'welcome' : 'choose',
      ...(mode === 'onboarding' ? restore(spaceId) : {}),
    })
  );
  const [result, setResult] = useState<ISchemaPackInstallVo>();
  const install = useInstallSchemaPacks();

  useEffect(() => {
    if (mode !== 'onboarding') return;
    try {
      sessionStorage.setItem(storageKey(spaceId), JSON.stringify(state));
    } catch {
      // Private mode or blocked storage: the wizard still works, it just won't survive a refresh.
    }
  }, [mode, spaceId, state]);

  // Only optional tables of the picked packs; restored state may hold others.
  const optionalTables = useMemo(
    () => state.optionalTables.filter((t) => state.packs.some((p) => optionalOf(p).includes(t))),
    [state.optionalTables, state.packs, optionalOf]
  );

  const planQuery = useInstallPlan(
    { packs: state.packs, optionalTables, starterRows: state.starterRows },
    baseId,
    state.step === 'review' || state.step === 'personalise'
  );

  const goto = useCallback((step: WizardStep) => dispatch({ type: 'goto', step }), []);
  const togglePack = useCallback(
    (pack: Parameters<typeof optionalOf>[0]) => dispatch({ type: 'togglePack', pack, optionalOf }),
    [optionalOf]
  );

  const build = () => {
    goto('building');
    install.reset();
    const options = {
      timezone: state.timezone,
      currency: state.currency,
      starterRows: state.starterRows,
      optionalTables,
    };
    install.mutate(
      baseId
        ? { kind: 'existing', baseId, ro: { packs: state.packs, options } }
        : {
            kind: 'new',
            ro: {
              spaceId,
              packs: state.packs,
              options: {
                ...options,
                baseName: state.baseName.trim() || t('personalise.defaultBaseName'),
                ...(state.icon.trim() ? { icon: state.icon.trim() } : {}),
              },
              ...(mode === 'onboarding' ? { completeOnboarding: true } : {}),
            },
          },
      {
        onSuccess: ({ data }) => {
          setResult(data);
          try {
            sessionStorage.removeItem(storageKey(spaceId));
          } catch {
            // see above
          }
          setTimeout(() => goto('ready'), 900);
        },
      }
    );
  };

  if (catalogQuery.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
        <p>{t('loadError')}</p>
        <Button variant="outline" size="sm" onClick={() => catalogQuery.refetch()}>
          {t('review.retry')}
        </Button>
      </div>
    );
  }
  if (!catalog) {
    return (
      <div className="mx-auto grid w-full max-w-4xl flex-1 grid-cols-1 gap-4 px-4 py-10 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-60 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-center pb-2 pt-1">
        <Stepper step={state.step} />
      </div>
      {state.step === 'welcome' && (
        <WelcomeStep name={user?.name ?? ''} onStart={() => goto('choose')} />
      )}
      {state.step === 'choose' && (
        <ChoosePacksStep
          catalog={catalog}
          packs={state.packs}
          optionalTables={optionalTables}
          onToggle={togglePack}
          onSelectAll={() => dispatch({ type: 'selectAll', optionalOf })}
          onContinue={() => goto('personalise')}
        />
      )}
      {state.step === 'personalise' && (
        <PersonaliseStep
          catalog={catalog}
          state={state}
          addingToBase={Boolean(baseId)}
          onChange={(patch) => dispatch({ type: 'set', patch })}
          onToggleOptional={(table) => dispatch({ type: 'toggleOptional', table })}
          onBack={() => goto('choose')}
          onContinue={() => goto('review')}
        />
      )}
      {state.step === 'review' && (
        <ReviewStep
          packs={state.packs}
          plan={planQuery.data}
          isLoading={planQuery.isFetching}
          isError={planQuery.isError}
          errorMessage={planQuery.error?.message}
          onRetry={() => planQuery.refetch()}
          onBack={() => goto('personalise')}
          onBuild={build}
        />
      )}
      {state.step === 'building' && (
        <BuildingStep
          catalog={catalog}
          packs={state.packs}
          optionalTables={optionalTables}
          starterRows={state.starterRows}
          done={install.isSuccess}
          error={install.error?.message}
          onRetry={build}
          onBack={() => goto('review')}
        />
      )}
      {state.step === 'ready' && result && (
        <ReadyStep
          packs={state.packs}
          result={result}
          addedToBase={Boolean(baseId)}
          onDone={onDone}
        />
      )}
    </div>
  );
};

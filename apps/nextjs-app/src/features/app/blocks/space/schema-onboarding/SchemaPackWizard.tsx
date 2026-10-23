import { useSession } from '@cybernetics/sdk/hooks';
import type { ISchemaPackInstallVo, SchemaPackId } from '@teable/openapi';
import {
  Button,
  cn,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BaseRail } from './components/BaseRail';
import { BuildOptions } from './components/BuildOptions';
import { FooterSummary, Stepper, STEPPER, WizardFooter } from './components/WizardChrome';
import {
  useInstallPlan,
  useInstallSchemaPacks,
  useOptionalOf,
  useSchemaPackCatalog,
} from './hooks';
import type { IWizardState, WizardStep } from './state';
import { canAdvance, createInitialState, restoreState, wizardReducer } from './state';
import { BuildingStep } from './steps/BuildingStep';
import { ChoosePacksStep } from './steps/ChoosePacksStep';
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
  /** Left of the stepper in the header, e.g. the dialog title. */
  title?: ReactNode;
}

/** Steps in flow order: a lower index slides in from the left, like going back. */
const ORDER: WizardStep[] = ['welcome', 'choose', 'review', 'building', 'ready'];
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

export const SchemaPackWizard = (props: ISchemaPackWizardProps) => {
  const { spaceId, mode, baseId, onDone, title } = props;
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
  const [mapOpen, setMapOpen] = useState(false);
  const [peek, setPeek] = useState<SchemaPackId | null>(null);
  const [hovered, setHovered] = useState<SchemaPackId | null>(null);
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
    state.step === 'review'
  );

  const goto = useCallback((step: WizardStep) => dispatch({ type: 'goto', step }), []);
  // Settled on the render a step changes, so the direction holds for the whole transition.
  const transition = useRef({ step: state.step, back: false });
  if (transition.current.step !== state.step) {
    const back = ORDER.indexOf(state.step) < ORDER.indexOf(transition.current.step);
    transition.current = { step: state.step, back };
  }
  const togglePack = useCallback(
    (pack: Parameters<typeof optionalOf>[0]) => dispatch({ type: 'togglePack', pack, optionalOf }),
    [optionalOf]
  );

  // The rail holds the details; where it is hidden (below lg), they open in the map sheet.
  const openPeek = useCallback((pack: SchemaPackId) => {
    const railShown = window.matchMedia('(min-width: 1024px)').matches;
    setPeek((current) => (railShown && current === pack ? null : pack));
    if (!railShown) setMapOpen(true);
  }, []);

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

  const framed = STEPPER.includes(state.step);
  const showHeader = Boolean(title) || framed;
  const header = showHeader && (
    <header
      className={cn(
        'flex shrink-0 items-center gap-4 px-4 py-3 sm:px-6',
        title ? 'justify-between border-b' : 'justify-center',
        mode === 'dialog' && 'pr-12'
      )}
    >
      {title}
      {catalog && <Stepper step={state.step} />}
    </header>
  );

  if (catalogQuery.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
          <p>{t('loadError')}</p>
          <Button variant="outline" size="sm" onClick={() => catalogQuery.refetch()}>
            {t('review.retry')}
          </Button>
        </div>
      </div>
    );
  }
  if (!catalog) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="mx-auto grid w-full max-w-4xl flex-1 grid-cols-1 gap-4 px-4 py-10 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-60 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const content = (
    <div
      key={state.step}
      className={cn(
        'flex flex-1 flex-col duration-200 animate-in fade-in motion-reduce:animate-none',
        transition.current.back ? 'slide-in-from-left-2' : 'slide-in-from-right-2'
      )}
    >
      {state.step === 'welcome' && (
        <WelcomeStep name={user?.name ?? ''} onStart={() => goto('choose')} />
      )}
      {state.step === 'choose' && (
        <ChoosePacksStep
          catalog={catalog}
          packs={state.packs}
          peek={peek}
          onToggle={togglePack}
          onPeek={openPeek}
          onHover={setHovered}
          onContinue={() => goto('review')}
        />
      )}
      {state.step === 'review' && (
        <ReviewStep
          packs={state.packs}
          catalog={catalog}
          plan={planQuery.data}
          isLoading={planQuery.isFetching}
          isError={planQuery.isError}
          errorMessage={planQuery.error?.message}
          onRetry={() => planQuery.refetch()}
          options={
            <BuildOptions
              catalog={catalog}
              state={state}
              addingToBase={Boolean(baseId)}
              onChange={(patch) => dispatch({ type: 'set', patch })}
              onToggleOptional={(table) => dispatch({ type: 'toggleOptional', table })}
            />
          }
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

  const rail = (
    <BaseRail
      catalog={catalog}
      packs={state.packs}
      optionalTables={optionalTables}
      onToggle={togglePack}
      peek={state.step === 'choose' ? peek : null}
      onClosePeek={() => setPeek(null)}
      highlight={state.step === 'choose' ? hovered : null}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {framed ? (
        // Content and rail scroll on their own, so a long peek never pushes the cards away.
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">{content}</div>
          </div>
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l bg-muted/30 p-5 lg:block">
            {rail}
          </aside>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{content}</div>
      )}
      {framed && (
        <WizardFooter
          step={state.step}
          summary={
            <FooterSummary
              catalog={catalog}
              packs={state.packs}
              optionalTables={optionalTables}
              onOpenMap={() => setMapOpen(true)}
            />
          }
          canAdvance={canAdvance(state, {
            addingToBase: Boolean(baseId),
            planReady: Boolean(planQuery.data) && !planQuery.isError,
          })}
          onSelectAll={() => dispatch({ type: 'selectAll', optionalOf })}
          onBack={() => goto('choose')}
          onNext={() => (state.step === 'review' ? build() : goto('review'))}
        />
      )}
      <Sheet
        open={framed && mapOpen}
        onOpenChange={(open) => {
          setMapOpen(open);
          if (!open) setPeek(null);
        }}
      >
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          {/* The rail brings its own visible heading. */}
          <SheetHeader className="sr-only">
            <SheetTitle>{t('choose.preview')}</SheetTitle>
          </SheetHeader>
          {rail}
        </SheetContent>
      </Sheet>
    </div>
  );
};

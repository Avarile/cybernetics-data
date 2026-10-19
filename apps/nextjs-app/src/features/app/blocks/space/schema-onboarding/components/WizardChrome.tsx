import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import type { WizardStep } from '../state';
import { useSelectionSummary } from './BaseRail';

/** The steps in the stepper, which also get the base rail and the footer. */
export const STEPPER: WizardStep[] = ['choose', 'review'];

export const Stepper = ({ step }: { step: WizardStep }) => {
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

/** The live selection; on small screens, where the rail is hidden, it opens the map. */
export const FooterSummary = (props: {
  catalog: ISchemaPackCatalogVo;
  packs: SchemaPackId[];
  optionalTables: string[];
  onOpenMap: () => void;
}) => {
  const { t } = useTranslation('onboarding');
  const summary = useSelectionSummary(props.catalog, props.packs, props.optionalTables);
  return (
    <>
      <span className="hidden truncate text-xs text-muted-foreground lg:inline">{summary}</span>
      <Button variant="outline" size="sm" className="w-full lg:hidden" onClick={props.onOpenMap}>
        <span className="truncate">
          {summary} · {t('choose.viewMap')}
        </span>
      </Button>
    </>
  );
};

interface IWizardFooterProps {
  step: WizardStep;
  summary: ReactNode;
  canAdvance: boolean;
  onSelectAll: () => void;
  onBack: () => void;
  onNext: () => void;
}

/** One footer for every step before the build, so Back and the next step never move. */
export const WizardFooter = (props: IWizardFooterProps) => {
  const { step, summary, canAdvance, onSelectAll, onBack, onNext } = props;
  const { t } = useTranslation('onboarding');
  const choosing = step === 'choose';
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
      <div className="order-first w-full lg:order-none lg:w-auto lg:flex-1 lg:text-center">
        {summary}
      </div>
      <div className="flex items-center gap-4 lg:-order-1 lg:flex-1">
        {choosing ? (
          <>
            <Button variant="ghost" size="sm" onClick={onSelectAll}>
              {t('choose.selectAll')}
            </Button>
            <span className="hidden text-xs text-muted-foreground xl:inline">
              {t('choose.keyboardHint')}
            </span>
          </>
        ) : (
          <Button variant="ghost" onClick={onBack}>
            {t('back')}
          </Button>
        )}
      </div>
      <div className="ml-auto flex items-center justify-end gap-3 lg:flex-1">
        {choosing && !canAdvance && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t('choose.pickOne')}
          </span>
        )}
        <Button className="gap-2" onClick={onNext} disabled={!canAdvance}>
          {step === 'review' ? (
            <>
              {t('review.build')}
              <Sparkles className="size-4" />
            </>
          ) : (
            t('continue')
          )}
        </Button>
      </div>
    </footer>
  );
};

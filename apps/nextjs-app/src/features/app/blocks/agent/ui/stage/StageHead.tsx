import { useTranslation } from 'next-i18next';
import type { ILensMode } from '../../model/lens';
import s from '../theme/cockpit.module.css';
import d from '../theme/deck.module.css';

export type ILayoutChoice = 'bundle' | 'tree';

/**
 * The chart's layout, BUNDLE or TREE, stacked under the readout in the HUD's top-left corner
 * (scope design §4.1).
 */
export const LayoutKnobs = (p: {
  layout: ILayoutChoice;
  onLayout: (layout: ILayoutChoice) => void;
}) => {
  const { t } = useTranslation('common');
  return (
    <div
      className={d.layoutKnobs}
      role="group"
      aria-label={t('agent.cockpit.view.layout', 'Layout')}
    >
      {(['bundle', 'tree'] as const).map((layout) => (
        <button
          key={layout}
          type="button"
          className={s.knob}
          aria-pressed={p.layout === layout}
          onClick={() => p.onLayout(layout)}
        >
          {layout === 'tree'
            ? t('agent.cockpit.view.tree', 'TREE')
            : t('agent.cockpit.view.bundle', 'BUNDLE')}
        </button>
      ))}
    </div>
  );
};

/** The answer's lens, under the ask panel's reply (the cockpit's lens row). */
export const LensKnobs = (p: {
  mode: ILensMode;
  cited: number;
  found: number;
  onLens: (lens: ILensMode) => void;
}) => {
  const { t } = useTranslation('common');
  return (
    <span className={s.knobs} role="group" aria-label={t('agent.cockpit.lens.label', 'Lens')}>
      <button
        type="button"
        className={s.knob}
        aria-pressed={p.mode === 'answer'}
        disabled={!p.cited}
        onClick={() => p.onLens('answer')}
      >
        {t('agent.cockpit.lens.answer', 'ANSWER')} {p.cited}
      </button>
      <button
        type="button"
        className={s.knob}
        aria-pressed={p.mode === 'retrieved'}
        onClick={() => p.onLens('retrieved')}
      >
        {t('agent.cockpit.lens.retrieved', 'RETRIEVED')} {p.found}
      </button>
    </span>
  );
};

/** What the chart is narrowed to, with the way back to everything found (the cockpit's chip). */
export const LensChip = ({
  text,
  searching,
  onOff,
}: {
  text: string;
  searching?: boolean;
  onOff?: () => void;
}) => {
  const { t } = useTranslation('common');
  return (
    <div className={d.lensChip} data-kind={searching ? 'searching' : 'answer'}>
      <i aria-hidden />
      <span>{text}</span>
      {onOff && (
        <button
          type="button"
          aria-label={t('agent.cockpit.lens.off', 'Show everything found')}
          onClick={onOff}
        >
          ✕
        </button>
      )}
    </div>
  );
};

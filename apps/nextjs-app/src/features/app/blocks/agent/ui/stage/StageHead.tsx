import { useTranslation } from 'next-i18next';
import type { ILensMode } from '../../model/lens';
import s from '../theme/cockpit.module.css';

export type IStageView = 'board' | 'constellation';
export type ILayoutChoice = 'bundle' | 'tree';

/** The stage's knobs: board or constellation (bundle or tree), and the lens (§5.3, §5.4). */
export const StageKnobs = (p: {
  view: IStageView;
  layout: ILayoutChoice;
  lens: ILensMode;
  cited: number;
  found: number;
  onView: (view: IStageView) => void;
  onLayout: (layout: ILayoutChoice) => void;
  onLens: (lens: ILensMode) => void;
}) => {
  const { t } = useTranslation('common');
  return (
    <>
      <span className={s.knobs} role="group" aria-label={t('agent.cockpit.view.label', 'View')}>
        <button
          type="button"
          className={s.knob}
          aria-pressed={p.view === 'board'}
          onClick={() => p.onView('board')}
        >
          {t('agent.cockpit.view.board', 'BOARD')}
        </button>
        <button
          type="button"
          className={s.knob}
          aria-pressed={p.view === 'constellation'}
          onClick={() => p.onView('constellation')}
        >
          {t('agent.cockpit.view.constellation', 'CONSTELLATION')}
        </button>
        {p.view === 'constellation' && (
          <button
            type="button"
            className={s.knob}
            aria-pressed={p.layout === 'tree'}
            onClick={() => p.onLayout(p.layout === 'tree' ? 'bundle' : 'tree')}
          >
            {t('agent.cockpit.view.tree', 'TREE')}
          </button>
        )}
      </span>
      <span className={s.knobs} role="group" aria-label={t('agent.cockpit.lens.label', 'Lens')}>
        <button
          type="button"
          className={s.knob}
          aria-pressed={p.lens === 'answer'}
          disabled={!p.cited}
          onClick={() => p.onLens('answer')}
        >
          {t('agent.cockpit.lens.answer', 'ANSWER')} {p.cited}
        </button>
        <button
          type="button"
          className={s.knob}
          aria-pressed={p.lens === 'retrieved'}
          onClick={() => p.onLens('retrieved')}
        >
          {t('agent.cockpit.lens.retrieved', 'RETRIEVED')} {p.found}
        </button>
      </span>
    </>
  );
};

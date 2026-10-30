import { useTranslation } from 'next-i18next';
import type { ILensMode } from '../../model/lens';
import s from '../theme/cockpit.module.css';

export type IStageView = 'board' | 'constellation';
export type ILayoutChoice = 'bundle' | 'tree';
export type IStageMode = 'overview' | 'search';

/**
 * The stage's knobs: the overview, a search as a board or a constellation (bundle or tree), and
 * a search's lens (cockpit design §5.3, §5.4; overview design §4.2).
 */
export const StageKnobs = (p: {
  mode: IStageMode;
  hasSearch: boolean;
  view: IStageView;
  layout: ILayoutChoice;
  /** The lens knobs show in search mode only. */
  lens?: { mode: ILensMode; cited: number; found: number; onLens: (lens: ILensMode) => void };
  onOverview: () => void;
  onView: (view: IStageView) => void;
  onLayout: (layout: ILayoutChoice) => void;
}) => {
  const { t } = useTranslation('common');
  const search = p.mode === 'search';
  const chart = !search || p.view === 'constellation';
  return (
    <>
      <span className={s.knobs} role="group" aria-label={t('agent.cockpit.view.label', 'View')}>
        <button type="button" className={s.knob} aria-pressed={!search} onClick={p.onOverview}>
          {t('agent.cockpit.view.overview', 'OVERVIEW')}
        </button>
        <button
          type="button"
          className={s.knob}
          aria-pressed={search && p.view === 'board'}
          disabled={!p.hasSearch}
          onClick={() => p.onView('board')}
        >
          {t('agent.cockpit.view.board', 'BOARD')}
        </button>
        <button
          type="button"
          className={s.knob}
          aria-pressed={search && p.view === 'constellation'}
          disabled={!p.hasSearch}
          onClick={() => p.onView('constellation')}
        >
          {t('agent.cockpit.view.constellation', 'CONSTELLATION')}
        </button>
        {chart && (
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
      {p.lens && (
        <span className={s.knobs} role="group" aria-label={t('agent.cockpit.lens.label', 'Lens')}>
          <button
            type="button"
            className={s.knob}
            aria-pressed={p.lens.mode === 'answer'}
            disabled={!p.lens.cited}
            onClick={() => p.lens!.onLens('answer')}
          >
            {t('agent.cockpit.lens.answer', 'ANSWER')} {p.lens.cited}
          </button>
          <button
            type="button"
            className={s.knob}
            aria-pressed={p.lens.mode === 'retrieved'}
            onClick={() => p.lens!.onLens('retrieved')}
          >
            {t('agent.cockpit.lens.retrieved', 'RETRIEVED')} {p.lens.found}
          </button>
        </span>
      )}
    </>
  );
};

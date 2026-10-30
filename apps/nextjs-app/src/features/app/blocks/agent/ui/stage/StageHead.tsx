import { useTranslation } from 'next-i18next';
import type { ILensMode } from '../../model/lens';
import s from '../theme/cockpit.module.css';
import d from '../theme/deck.module.css';

export type IStageView = 'board' | 'constellation';
export type ILayoutChoice = 'bundle' | 'tree';
export type IStageMode = 'overview' | 'search';

/**
 * The stage's knobs, top-right of the HUD (the cockpit's ov-tr): the overview or a search as a
 * board or a constellation, and a chart's layout, BUNDLE or TREE (cockpit design §5.3, §5.4;
 * overview design §4.2).
 */
export const StageKnobs = (p: {
  mode: IStageMode;
  hasSearch: boolean;
  view: IStageView;
  layout: ILayoutChoice;
  onOverview: () => void;
  onView: (view: IStageView) => void;
  onLayout: (layout: ILayoutChoice) => void;
}) => {
  const { t } = useTranslation('common');
  const search = p.mode === 'search';
  const chart = !search || p.view === 'constellation';
  return (
    <>
      <span className={s.knobs}>
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
      </span>
      {chart && (
        <span className={s.knobs}>
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
        </span>
      )}
    </>
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

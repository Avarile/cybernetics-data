import { useTranslation } from 'next-i18next';
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

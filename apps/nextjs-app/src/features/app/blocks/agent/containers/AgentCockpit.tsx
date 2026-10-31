import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';
import { useCockpitKeys } from '../hooks/useCockpitKeys';
import { useTableSearch } from '../hooks/useTableSearch';
import { useCockpitStore } from '../state/cockpit-store';
import s from '../ui/theme/cockpit.module.css';
import d from '../ui/theme/deck.module.css';
import { cockpitFonts } from '../ui/theme/fonts';
import { AnnunciatorContainer } from './AnnunciatorContainer';
import { AskContainer } from './AskContainer';
import { StageContainer } from './StageContainer';

/**
 * The cockpit: one full-screen surface over the app, on or off (cockpit design §4, §5), laid out
 * as the ai-cockpit: the annunciator on top, the stage full-bleed under everything, the rail of
 * panels on the right. While on, the page beneath is inert; focus comes back to where it was
 * when it turns off.
 */
export const AgentCockpit = () => {
  const { t } = useTranslation('common');
  const root = useRef<HTMLDivElement>(null);
  // the rail outlives the stages, so the conversation in it is never remounted
  const [rail, setRail] = useState<HTMLElement | null>(null);
  const palette = useCockpitStore((st) => st.palette);
  useCockpitKeys(root);
  // the search's side effects (forced results, the log, following the table) run once, here
  useTableSearch(true);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const app = document.getElementById('__next');
    app?.setAttribute('inert', '');
    root.current?.querySelector<HTMLElement>('textarea')?.focus();
    return () => {
      app?.removeAttribute('inert');
      before?.focus?.();
    };
  }, []);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t('agent.cockpit.label', 'Agent cockpit')}
      data-palette={palette}
      className={`dark ${s.cockpit} ${cockpitFonts}`}
    >
      <div className={d.deck} data-deck>
        <AnnunciatorContainer />
        <StageContainer rail={rail} />
        <div className={d.grid}>
          <aside ref={setRail} className={d.rail} data-rail>
            <AskContainer />
          </aside>
        </div>
      </div>
    </div>
  );
};

import type { IClarifyOption } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef } from 'react';
import { useAgentSession } from '../hooks/useAgentSession';
import { useCockpitKeys } from '../hooks/useCockpitKeys';
import { choiceFor } from '../model/transcript';
import { useCockpitStore } from '../state/cockpit-store';
import s from '../ui/theme/cockpit.module.css';
import { cockpitFonts } from '../ui/theme/fonts';
import { AnnunciatorContainer } from './AnnunciatorContainer';
import { AskContainer } from './AskContainer';
import { StageContainer } from './StageContainer';

/**
 * The cockpit: one full-screen surface over the app, on or off (cockpit design §4, §5). While on,
 * the page beneath is inert; focus comes back to where it was when it turns off.
 */
export const AgentCockpit = () => {
  const { t } = useTranslation('common');
  const root = useRef<HTMLDivElement>(null);
  const palette = useCockpitStore((st) => st.palette);
  const selectSearch = useCockpitStore((st) => st.selectSearch);
  const chat = useAgentSession();
  useCockpitKeys(root);

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

  /** An option of a clarify card (or a PICK on a card): the admin's answer, with its choice. */
  const { send } = chat;
  const pick = useCallback(
    (option: IClarifyOption, clarifyId: string) => {
      selectSearch(undefined);
      void send(option.label, choiceFor(clarifyId, option));
    },
    [selectSearch, send]
  );

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t('agent.cockpit.label', 'Agent cockpit')}
      data-palette={palette}
      className={`dark ${s.cockpit} ${cockpitFonts}`}
    >
      <AnnunciatorContainer />
      <div className={s.deck}>
        <StageContainer onPick={pick} />
        <AskContainer onPick={pick} />
      </div>
    </div>
  );
};

import { useTranslation } from 'next-i18next';
import { useEffect, useRef } from 'react';
import { AnnunciatorContainer } from './AnnunciatorContainer';
import { AskContainer } from './AskContainer';

/**
 * The cockpit: one full-screen surface over the app, on or off (cockpit design §4). While on,
 * the page beneath is inert; focus comes back to where it was when it turns off.
 */
export const AgentCockpit = () => {
  const { t } = useTranslation('common');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const app = document.getElementById('__next');
    app?.setAttribute('inert', '');
    root.current?.querySelector<HTMLElement>('textarea, input')?.focus();
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
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
    >
      <AnnunciatorContainer />
      <main className="flex min-h-0 flex-1 flex-col">
        <AskContainer />
      </main>
    </div>
  );
};

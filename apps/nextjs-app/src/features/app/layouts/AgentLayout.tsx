import type { IUser } from '@cybernetics/sdk';
import { AppProvider, SessionProvider } from '@cybernetics/sdk';
import type { DehydratedState } from '@tanstack/react-query';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { AppLayout } from './AppLayout';

/** Providers for the full-screen /agent page (its own thread list replaces the sidebar). */
export const AgentLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  dehydratedState?: DehydratedState;
}> = ({ children, user, dehydratedState }) => {
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  return (
    <AppLayout>
      <AppProvider lang={i18n.language} locale={sdkLocale} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <div id="portal" className="relative flex h-screen w-full">
            {children}
          </div>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};

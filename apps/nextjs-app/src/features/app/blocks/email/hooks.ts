import { ReactQueryKeys } from '@cybernetics/sdk/config';
import { useQuery } from '@tanstack/react-query';
import type { IEmailSourceVo, IUserIntegrationItemVo } from '@teable/openapi';
import {
  EmailSourceStatus,
  getEmailSourceList,
  getUserIntegrationFolders,
  getUserIntegrationList,
  UserIntegrationProvider,
} from '@teable/openapi';
import { useCallback, useEffect, useRef } from 'react';

export const emailQueryKeys = {
  sources: (baseId: string) => ['email-sources', baseId] as const,
  folders: (integrationId: string) => ['email-folders', integrationId] as const,
};

export const MAIL_PROVIDERS: UserIntegrationProvider[] = [
  UserIntegrationProvider.Gmail,
  UserIntegrationProvider.Outlook,
  UserIntegrationProvider.Imap,
];

/** Email tables of a base; polls faster while one of them is syncing. */
export const useEmailSources = (baseId?: string) =>
  useQuery({
    queryKey: emailQueryKeys.sources(baseId ?? ''),
    queryFn: () => getEmailSourceList(baseId!).then((res) => res.data),
    enabled: Boolean(baseId),
    refetchInterval: (query) =>
      query.state.data?.some((source) => source.status === EmailSourceStatus.Syncing)
        ? 5_000
        : 60_000,
  });

export const useEmailSource = (baseId: string, tableId: string): IEmailSourceVo | undefined => {
  const { data } = useEmailSources(baseId);
  return data?.find((source) => source.tableId === tableId);
};

export const useMailIntegrations = () =>
  useQuery({
    queryKey: ReactQueryKeys.getUserIntegrations(),
    queryFn: () => getUserIntegrationList().then((res) => res.data),
    select: (data): IUserIntegrationItemVo[] =>
      data.integrations.filter((integration) => MAIL_PROVIDERS.includes(integration.provider)),
  });

export const useMailFolders = (integrationId?: string) =>
  useQuery({
    queryKey: emailQueryKeys.folders(integrationId ?? ''),
    queryFn: () => getUserIntegrationFolders(integrationId!).then((res) => res.data),
    enabled: Boolean(integrationId),
    retry: false,
    staleTime: 60_000,
  });

export interface IOAuthPopupResult {
  type: 'user-integration';
  status: 'success' | 'error';
  provider: string;
  integrationId?: string;
  message?: string;
}

const isPopupResult = (data: unknown): data is IOAuthPopupResult =>
  typeof data === 'object' &&
  data !== null &&
  (data as { type?: unknown }).type === 'user-integration';

/**
 * Opens the OAuth consent popup for a mail provider. The callback page reports back by
 * postMessage (to this origin only) and on a BroadcastChannel, so both may arrive.
 */
export const useOAuthPopup = (onResult: (result: IOAuthPopupResult) => void) => {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let last = '';
    const handle = (data: unknown) => {
      if (!isPopupResult(data)) return;
      const key = JSON.stringify(data);
      if (key === last) return;
      last = key;
      onResultRef.current(data);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) handle(event.data);
    };
    window.addEventListener('message', onMessage);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel('user-integration');
      channel.onmessage = (event) => handle(event.data);
    } catch {
      // older browsers: postMessage still works
    }
    return () => {
      window.removeEventListener('message', onMessage);
      channel?.close();
    };
  }, []);

  return useCallback((provider: UserIntegrationProvider, name?: string) => {
    const query = new URLSearchParams(name ? { name } : {});
    window.open(
      `/api/user-integrations/authorize/${provider}?${query}`,
      'user-integration-oauth',
      'popup,width=520,height=720'
    );
  }, []);
};

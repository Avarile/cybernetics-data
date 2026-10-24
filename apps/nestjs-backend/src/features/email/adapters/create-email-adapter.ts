/* eslint-disable @typescript-eslint/naming-convention */
import { UserIntegrationProvider } from '@teable/openapi';
import type { IMailAccess } from '../../user-integration/user-integration.service';
import type { IEmailAdapter } from './email-adapter.types';
import { GmailEmailAdapter } from './gmail.adapter';
import { GraphEmailAdapter } from './graph.adapter';
import { ImapEmailAdapter } from './imap.adapter';

// tokens are handed out with at least a minute left, so a short reuse is safe
const TOKEN_REUSE_MS = 30_000;

const reuseToken = (getAccessToken: () => Promise<string>) => {
  let cached: { token: string; at: number } | undefined;
  return async () => {
    if (!cached || Date.now() - cached.at > TOKEN_REUSE_MS) {
      cached = { token: await getAccessToken(), at: Date.now() };
    }
    return cached.token;
  };
};

export const createEmailAdapter = (access: IMailAccess): IEmailAdapter => {
  switch (access.kind) {
    case 'imap':
      return new ImapEmailAdapter(access.server, access.allowPrivateHosts);
    case UserIntegrationProvider.Gmail:
      return new GmailEmailAdapter(reuseToken(access.getAccessToken));
    case UserIntegrationProvider.Outlook:
      return new GraphEmailAdapter(reuseToken(access.getAccessToken));
  }
};

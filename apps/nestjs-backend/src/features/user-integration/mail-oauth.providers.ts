/* eslint-disable @typescript-eslint/naming-convention */
import { UserIntegrationProvider } from '@teable/openapi';
import axios, { isAxiosError } from 'axios';
import type { IIntegrationConfig } from '../../configs/integration.config';

export interface IOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt: number;
  scope?: string;
}

export interface IOAuthUserInfo {
  email: string;
  name: string;
}

/** The provider rejected the refresh token or code: the user has to connect again. */
export class OAuthGrantError extends Error {}

export interface IMailOAuthProvider {
  readonly provider: UserIntegrationProvider;
  /** a scope that must be granted, e.g. Google lets users untick Gmail access on the consent screen */
  readonly requiredScope: string;
  getAuthorizeUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<IOAuthTokens>;
  refresh(refreshToken: string): Promise<IOAuthTokens>;
  getUserInfo(accessToken: string): Promise<IOAuthUserInfo>;
}

interface ITokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

const postTokenForm = async (url: string, form: Record<string, string>): Promise<IOAuthTokens> => {
  try {
    const { data } = await axios.post<ITokenResponse>(url, new URLSearchParams(form).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      scope: data.scope,
    };
  } catch (error) {
    const code = isAxiosError(error) ? (error.response?.data as { error?: string })?.error : null;
    if (code === 'invalid_grant') {
      throw new OAuthGrantError('The authorization is no longer valid');
    }
    throw error;
  }
};

class GoogleMailOAuthProvider implements IMailOAuthProvider {
  readonly provider = UserIntegrationProvider.Gmail;
  readonly requiredScope = 'https://www.googleapis.com/auth/gmail.readonly';

  constructor(private readonly config: { clientId: string; clientSecret: string }) {}

  getAuthorizeUrl({
    state,
    codeChallenge,
    redirectUri,
  }: Parameters<IMailOAuthProvider['getAuthorizeUrl']>[0]) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: ['openid', 'email', 'profile', this.requiredScope].join(' '),
      // offline + consent so Google returns a refresh token every time
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  exchangeCode({
    code,
    codeVerifier,
    redirectUri,
  }: Parameters<IMailOAuthProvider['exchangeCode']>[0]) {
    return postTokenForm('https://oauth2.googleapis.com/token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
  }

  refresh(refreshToken: string) {
    return postTokenForm('https://oauth2.googleapis.com/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
  }

  async getUserInfo(accessToken: string) {
    const { data } = await axios.get<{ email: string; name?: string }>(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 }
    );
    return { email: data.email, name: data.name ?? data.email };
  }
}

class MicrosoftMailOAuthProvider implements IMailOAuthProvider {
  readonly provider = UserIntegrationProvider.Outlook;
  readonly requiredScope = 'Mail.Read';
  private readonly scope = [
    'openid',
    'email',
    'profile',
    'offline_access',
    'User.Read',
    'Mail.Read',
  ];

  constructor(
    private readonly config: { clientId: string; clientSecret: string; tenant: string }
  ) {}

  private get baseUrl() {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenant)}/oauth2/v2.0`;
  }

  getAuthorizeUrl({
    state,
    codeChallenge,
    redirectUri,
  }: Parameters<IMailOAuthProvider['getAuthorizeUrl']>[0]) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: this.scope.join(' '),
      prompt: 'select_account',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${this.baseUrl}/authorize?${params}`;
  }

  exchangeCode({
    code,
    codeVerifier,
    redirectUri,
  }: Parameters<IMailOAuthProvider['exchangeCode']>[0]) {
    return postTokenForm(`${this.baseUrl}/token`, {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      scope: this.scope.join(' '),
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
  }

  refresh(refreshToken: string) {
    return postTokenForm(`${this.baseUrl}/token`, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: this.scope.join(' '),
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
  }

  async getUserInfo(accessToken: string) {
    const { data } = await axios.get<{
      displayName?: string;
      mail?: string | null;
      userPrincipalName: string;
    }>('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
    });
    const email = data.mail || data.userPrincipalName;
    return { email, name: data.displayName || email };
  }
}

/** The OAuth provider for a mail integration, or undefined when it is not configured. */
export const getMailOAuthProvider = (
  provider: string,
  config: IIntegrationConfig
): IMailOAuthProvider | undefined => {
  if (provider === UserIntegrationProvider.Gmail) {
    const { clientId, clientSecret } = config.gmail;
    return clientId && clientSecret
      ? new GoogleMailOAuthProvider({ clientId, clientSecret })
      : undefined;
  }
  if (provider === UserIntegrationProvider.Outlook) {
    const { clientId, clientSecret, tenant } = config.outlook;
    return clientId && clientSecret
      ? new MicrosoftMailOAuthProvider({ clientId, clientSecret, tenant })
      : undefined;
  }
  return undefined;
};

/** Whether the token response grants a scope; providers that omit `scope` grant what was asked. */
export const hasScope = (tokens: IOAuthTokens, scope: string) =>
  tokens.scope === undefined ||
  tokens.scope
    .split(/\s+/)
    .some(
      (granted) =>
        granted.toLowerCase() === scope.toLowerCase() ||
        granted.toLowerCase().endsWith(`/${scope.toLowerCase()}`)
    );

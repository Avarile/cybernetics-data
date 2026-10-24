/* eslint-disable @typescript-eslint/naming-convention */
import { createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { generateUserIntegrationId, HttpErrorCode } from '@teable/core';
import type { UserIntegration } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateImapIntegrationRo,
  ICreateImapIntegrationVo,
  ITestConnectionRo,
  ITestConnectionVo,
  IUserIntegrationImapMetadata,
  IUserIntegrationItemVo,
  IUserIntegrationListVo,
  IUserIntegrationTokenVo,
} from '@teable/openapi';
import { UserIntegrationProvider, UserIntegrationStatus } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { IntegrationConfig, IIntegrationConfig } from '../../configs/integration.config';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { IntegrationSecretCipher } from './integration-secret.cipher';
import type { IMailOAuthProvider, IOAuthTokens, IOAuthUserInfo } from './mail-oauth.providers';
import { getMailOAuthProvider, hasScope, OAuthGrantError } from './mail-oauth.providers';
import type { IMailServerCredentials } from './mail-server.tester';
import { describeMailServerError, MailServerTester } from './mail-server.tester';

type IOAuthSecret = IOAuthTokens;

interface IImapSecret {
  password: string;
  smtpPassword?: string;
}

export type IMailAccess =
  | { kind: 'imap'; server: IMailServerCredentials; allowPrivateHosts: boolean }
  | {
      kind: UserIntegrationProvider.Gmail | UserIntegrationProvider.Outlook;
      getAccessToken: () => Promise<string>;
    };

export type IOAuthCallbackResult =
  | { status: 'success'; provider: string; integrationId: string }
  | { status: 'error'; provider: string; message: string };

const OAUTH_STATE_TTL_SECONDS = 600;
// refresh a little early so a token does not expire mid-request
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const CONNECTION_TESTS_PER_MINUTE = 10;
const NAME_MAX_LENGTH = 100;

const PROVIDER_LABELS: Record<UserIntegrationProvider, string> = {
  [UserIntegrationProvider.Slack]: 'Slack',
  [UserIntegrationProvider.Gmail]: 'Gmail',
  [UserIntegrationProvider.Outlook]: 'Outlook',
  [UserIntegrationProvider.Imap]: 'IMAP',
};

const base64Url = (buffer: Buffer) => buffer.toString('base64url');

/**
 * Per-user connected accounts (mailboxes for now). Every route acts on the signed-in user's own
 * integrations only; an id that belongs to someone else is reported as not found.
 */
@Injectable()
export class UserIntegrationService {
  private readonly logger = new Logger(UserIntegrationService.name);
  private readonly cipher: IntegrationSecretCipher;
  private readonly tester: MailServerTester;
  // one refresh per integration at a time; Microsoft rotates refresh tokens on every use
  private readonly refreshing = new Map<string, Promise<IOAuthSecret>>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService,
    @IntegrationConfig() private readonly integrationConfig: IIntegrationConfig,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {
    if (!integrationConfig.encryptionKey) {
      this.logger.warn(
        'BACKEND_INTEGRATION_ENCRYPTION_KEY is not set; integration secrets use a key derived from SECRET_KEY'
      );
    }
    this.cipher = IntegrationSecretCipher.fromConfig(
      integrationConfig.encryptionKey,
      baseConfig.secretKey
    );
    this.tester = new MailServerTester(integrationConfig.allowPrivateMailHosts);
  }

  private get userId() {
    return this.cls.get('user.id');
  }

  private notFound(): never {
    throw new CustomHttpException('Integration not found', HttpErrorCode.NOT_FOUND);
  }

  /** The signed-in user's integration, or 404 (also for someone else's id). */
  async getOwned(integrationId: string) {
    const integration = await this.prismaService.userIntegration.findFirst({
      where: { id: integrationId, userId: this.userId },
    });
    return integration ?? this.notFound();
  }

  /**
   * How to reach a mailbox, for the email sync engine (which runs as the integration's owner).
   * Never returned to clients.
   */
  getMailAccess(integration: UserIntegration): IMailAccess {
    if (integration.provider === UserIntegrationProvider.Imap) {
      if (!integration.secret) {
        throw new CustomHttpException(
          'The mailbox has no saved password',
          HttpErrorCode.FAILED_DEPENDENCY
        );
      }
      const { password } = this.cipher.decrypt<IImapSecret>(integration.secret, integration.id);
      const { imap } = JSON.parse(integration.metadata ?? '{}') as IUserIntegrationImapMetadata;
      return {
        kind: 'imap',
        server: { ...imap, password },
        allowPrivateHosts: this.integrationConfig.allowPrivateMailHosts,
      };
    }
    if (
      integration.provider === UserIntegrationProvider.Gmail ||
      integration.provider === UserIntegrationProvider.Outlook
    ) {
      return {
        kind: integration.provider,
        getAccessToken: async () => {
          // re-read so a token refreshed by another run is reused
          const fresh = await this.prismaService.userIntegration.findUniqueOrThrow({
            where: { id: integration.id },
          });
          return this.resolveAccessToken(fresh);
        },
      };
    }
    throw new CustomHttpException(
      `${integration.provider} is not a mailbox integration`,
      HttpErrorCode.VALIDATION_ERROR
    );
  }

  private toVo(integration: UserIntegration): IUserIntegrationItemVo {
    return {
      id: integration.id,
      userId: integration.userId,
      provider: integration.provider as UserIntegrationProvider,
      name: integration.name,
      lastUsedTime: integration.lastUsedTime?.toISOString(),
      createdTime: integration.createdTime.toISOString(),
      connectedTime: integration.connectedTime?.toISOString(),
      lastModifiedTime: integration.lastModifiedTime?.toISOString(),
      hasSecret: Boolean(integration.secret),
      status: integration.status as UserIntegrationStatus,
      metadata: JSON.parse(integration.metadata ?? '{}'),
    };
  }

  async list(provider?: UserIntegrationProvider): Promise<IUserIntegrationListVo> {
    const integrations = await this.prismaService.userIntegration.findMany({
      where: { userId: this.userId, ...(provider ? { provider } : {}) },
      orderBy: { createdTime: 'asc' },
    });
    return { integrations: integrations.map((integration) => this.toVo(integration)) };
  }

  async rename(integrationId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > NAME_MAX_LENGTH) {
      throw new CustomHttpException(
        `Name must be 1 to ${NAME_MAX_LENGTH} characters`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    await this.getOwned(integrationId);
    await this.prismaService.userIntegration.update({
      where: { id: integrationId },
      data: { name: trimmed },
    });
  }

  /** Email tables fed by the integration keep their records and stop syncing. */
  async delete(integrationId: string) {
    await this.getOwned(integrationId);
    await this.prismaService.$tx(async (prisma) => {
      await prisma.emailSource.updateMany({
        where: { integrationId, deletedTime: null },
        data: { status: 'disconnected' },
      });
      await prisma.userIntegration.delete({ where: { id: integrationId } });
    });
  }

  async getAccessToken(integrationId: string): Promise<IUserIntegrationTokenVo> {
    const integration = await this.getOwned(integrationId);
    return { accessToken: await this.resolveAccessToken(integration) };
  }

  /** A valid OAuth access token, refreshed when it is about to expire. */
  async resolveAccessToken(integration: UserIntegration): Promise<string> {
    const provider = getMailOAuthProvider(integration.provider, this.integrationConfig);
    if (!provider || !integration.secret) {
      throw new CustomHttpException(
        'This integration does not use OAuth tokens',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    let secret = this.cipher.decrypt<IOAuthSecret>(integration.secret, integration.id);
    if (secret.expiresAt - TOKEN_REFRESH_MARGIN_MS <= Date.now()) {
      secret = await this.refreshOnce(integration, provider, secret);
    }
    await this.prismaService.userIntegration.update({
      where: { id: integration.id },
      data: { lastUsedTime: new Date() },
    });
    return secret.accessToken;
  }

  private refreshOnce(
    integration: UserIntegration,
    provider: IMailOAuthProvider,
    secret: IOAuthSecret
  ): Promise<IOAuthSecret> {
    const pending = this.refreshing.get(integration.id);
    if (pending) return pending;
    const run = this.refresh(integration, provider, secret).finally(() =>
      this.refreshing.delete(integration.id)
    );
    this.refreshing.set(integration.id, run);
    return run;
  }

  private async refresh(
    integration: UserIntegration,
    provider: IMailOAuthProvider,
    secret: IOAuthSecret
  ): Promise<IOAuthSecret> {
    try {
      if (!secret.refreshToken) {
        throw new OAuthGrantError('No refresh token');
      }
      const tokens = await provider.refresh(secret.refreshToken);
      const next: IOAuthSecret = {
        ...tokens,
        // Google keeps the old refresh token and only sends a new one on consent
        refreshToken: tokens.refreshToken ?? secret.refreshToken,
      };
      await this.prismaService.userIntegration.update({
        where: { id: integration.id },
        data: {
          secret: this.cipher.encrypt(next, integration.id),
          status: UserIntegrationStatus.Active,
        },
      });
      return next;
    } catch (error) {
      if (error instanceof OAuthGrantError) {
        await this.markNeedsReauth(integration.id);
        throw new CustomHttpException(
          'The mailbox authorization has expired; connect it again',
          HttpErrorCode.FAILED_DEPENDENCY
        );
      }
      this.logger.error(`Token refresh failed for ${integration.id}: ${error}`);
      throw new CustomHttpException(
        'Could not refresh the mailbox authorization',
        HttpErrorCode.FAILED_DEPENDENCY
      );
    }
  }

  private async markNeedsReauth(integrationId: string) {
    await this.prismaService.$tx(async (prisma) => {
      await prisma.userIntegration.update({
        where: { id: integrationId },
        data: { status: UserIntegrationStatus.NeedsReauth },
      });
      await prisma.emailSource.updateMany({
        where: { integrationId, deletedTime: null },
        data: { status: 'disconnected' },
      });
    });
  }

  getOAuthRedirectUri(provider: string) {
    return `${this.baseConfig.publicOrigin}/api/user-integrations/callback/${provider}`;
  }

  /** The provider's consent URL; state and the PKCE verifier wait in the cache for the callback. */
  async startAuthorize(provider: string, name?: string): Promise<string> {
    const oauth = getMailOAuthProvider(provider, this.integrationConfig);
    if (!oauth) {
      throw new CustomHttpException(
        `Provider ${provider} is not available`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    const state = base64Url(randomBytes(32));
    const codeVerifier = base64Url(randomBytes(32));
    const trimmedName = name?.trim().slice(0, NAME_MAX_LENGTH) || undefined;
    await this.cacheService.setDetail(
      `user-integration:oauth:${state}`,
      { userId: this.userId, provider, name: trimmedName, codeVerifier },
      OAUTH_STATE_TTL_SECONDS
    );
    return oauth.getAuthorizeUrl({
      state,
      codeChallenge: base64Url(createHash('sha256').update(codeVerifier).digest()),
      redirectUri: this.getOAuthRedirectUri(provider),
    });
  }

  /** Never throws: the result is rendered as the popup's closing page. */
  async completeAuthorize(
    provider: string,
    query: { code?: string; state?: string; error?: string }
  ): Promise<IOAuthCallbackResult> {
    const fail = (message: string): IOAuthCallbackResult => ({
      status: 'error',
      provider,
      message,
    });
    const oauth = getMailOAuthProvider(provider, this.integrationConfig);
    if (!oauth || !query.state) {
      return fail('Invalid authorization request');
    }
    const key = `user-integration:oauth:${query.state}` as const;
    const pending = await this.cacheService.get(key);
    await this.cacheService.del(key);
    if (!pending || pending.provider !== provider || pending.userId !== this.userId) {
      return fail('The authorization request expired or is invalid; try again');
    }
    if (query.error || !query.code) {
      return fail('Authorization was cancelled');
    }

    try {
      const tokens = await oauth.exchangeCode({
        code: query.code,
        codeVerifier: pending.codeVerifier,
        redirectUri: this.getOAuthRedirectUri(provider),
      });
      if (!hasScope(tokens, oauth.requiredScope)) {
        return fail('Mail access was not granted; allow it on the consent screen');
      }
      const userInfo = await oauth.getUserInfo(tokens.accessToken);
      const integrationId = await this.upsertOAuth(oauth.provider, pending.name, tokens, userInfo);
      return { status: 'success', provider, integrationId };
    } catch (error) {
      this.logger.error(`OAuth callback for ${provider} failed: ${error}`);
      return fail('Could not complete the authorization');
    }
  }

  private async upsertOAuth(
    provider: UserIntegrationProvider,
    name: string | undefined,
    tokens: IOAuthTokens,
    userInfo: IOAuthUserInfo
  ) {
    const userId = this.userId;
    const address = userInfo.email.toLowerCase();
    const existing = await this.prismaService.userIntegration.findUnique({
      where: { userId_provider_address: { userId, provider, address } },
    });
    const id = existing?.id ?? generateUserIntegrationId();
    const previous = existing?.secret
      ? this.tryDecrypt<IOAuthSecret>(existing.secret, existing.id)
      : undefined;
    const secret: IOAuthSecret = {
      ...tokens,
      refreshToken: tokens.refreshToken ?? previous?.refreshToken,
    };
    const data = {
      secret: this.cipher.encrypt(secret, id),
      metadata: JSON.stringify({ userInfo: { email: userInfo.email, name: userInfo.name } }),
      status: UserIntegrationStatus.Active,
      connectedTime: new Date(),
    };
    await this.prismaService.userIntegration.upsert({
      where: { userId_provider_address: { userId, provider, address } },
      // a reconnect keeps the name the user gave it
      update: data,
      create: {
        id,
        userId,
        provider,
        address,
        name: name ?? `${PROVIDER_LABELS[provider]} (${userInfo.email})`,
        ...data,
      },
    });
    await this.resumeSources(id);
    return id;
  }

  /** Email tables stopped by an expired authorization start syncing again. */
  private async resumeSources(integrationId: string) {
    await this.prismaService.emailSource.updateMany({
      where: { integrationId, status: 'disconnected', deletedTime: null },
      data: { status: 'idle', lastError: null },
    });
  }

  private tryDecrypt<T>(value: string, aad: string): T | undefined {
    try {
      return this.cipher.decrypt<T>(value, aad);
    } catch {
      return undefined;
    }
  }

  private async assertTestRate() {
    const key =
      `user-integration:test-rate:${this.userId}:${Math.floor(Date.now() / 60_000)}` as const;
    if ((await this.cacheService.incr(key, 60)) > CONNECTION_TESTS_PER_MINUTE) {
      throw new CustomHttpException(
        'Too many connection tests; wait a minute and try again',
        HttpErrorCode.TOO_MANY_REQUESTS
      );
    }
  }

  private async runTest(test: () => Promise<void>) {
    try {
      await test();
      return { ok: true };
    } catch (error) {
      this.logger.debug(`Mail server test failed: ${error}`);
      return { ok: false, error: describeMailServerError(error) };
    }
  }

  async testConnection(ro: ITestConnectionRo): Promise<ITestConnectionVo> {
    await this.assertTestRate();
    const [imap, smtp] = await Promise.all([
      ro.imap && this.runTest(() => this.tester.testImap(ro.imap!)),
      ro.smtp && this.runTest(() => this.tester.testSmtp(ro.smtp!)),
    ]);
    return { ...(imap ? { imap } : {}), ...(smtp ? { smtp } : {}) };
  }

  /** Tests the servers, then saves; connecting an address again updates its integration. */
  async createImap(ro: ICreateImapIntegrationRo): Promise<ICreateImapIntegrationVo> {
    await this.assertTestRate();
    const smtp: IMailServerCredentials | undefined = ro.smtp && {
      ...ro.smtp,
      password: ro.smtp.password ?? ro.imap.password,
    };
    const [imapResult, smtpResult] = await Promise.all([
      this.runTest(() => this.tester.testImap(ro.imap)),
      smtp && this.runTest(() => this.tester.testSmtp(smtp)),
    ]);
    if (!imapResult.ok) {
      throw new CustomHttpException(`IMAP: ${imapResult.error}`, HttpErrorCode.VALIDATION_ERROR);
    }
    if (smtpResult && !smtpResult.ok) {
      throw new CustomHttpException(`SMTP: ${smtpResult.error}`, HttpErrorCode.VALIDATION_ERROR);
    }

    const userId = this.userId;
    const provider = UserIntegrationProvider.Imap;
    const address = ro.email.toLowerCase();
    const existing = await this.prismaService.userIntegration.findUnique({
      where: { userId_provider_address: { userId, provider, address } },
      select: { id: true },
    });
    const id = existing?.id ?? generateUserIntegrationId();
    const serverMeta = ({ host, port, secure, username }: IMailServerCredentials) => ({
      host,
      port,
      secure,
      username,
    });
    const metadata: IUserIntegrationImapMetadata = {
      userInfo: { email: ro.email, name: ro.displayName || ro.email },
      imap: serverMeta(ro.imap),
      ...(smtp ? { smtp: serverMeta(smtp) } : {}),
    };
    const secret: IImapSecret = {
      password: ro.imap.password,
      ...(ro.smtp?.password ? { smtpPassword: ro.smtp.password } : {}),
    };
    const data = {
      secret: this.cipher.encrypt(secret, id),
      metadata: JSON.stringify(metadata),
      status: UserIntegrationStatus.Active,
      connectedTime: new Date(),
      ...(ro.name ? { name: ro.name } : {}),
    };
    await this.prismaService.userIntegration.upsert({
      where: { userId_provider_address: { userId, provider, address } },
      update: data,
      create: {
        id,
        userId,
        provider,
        address,
        name: `${PROVIDER_LABELS[provider]} (${ro.email})`,
        ...data,
      },
    });
    await this.resumeSources(id);
    return { id };
  }
}

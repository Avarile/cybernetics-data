/* eslint-disable @typescript-eslint/naming-convention, sonarjs/no-duplicate-string */
import { randomBytes } from 'crypto';
import type { PrismaService, UserIntegration } from '@teable/db-main-prisma';
import { UserIntegrationProvider, UserIntegrationStatus } from '@teable/openapi';
import axios from 'axios';
import Keyv from 'keyv';
import type { ClsService } from 'nestjs-cls';
import { mockDeep } from 'vitest-mock-extended';
import { CacheService } from '../../cache/cache.service';
import type { IBaseConfig } from '../../configs/base.config';
import type { IIntegrationConfig } from '../../configs/integration.config';
import type { IClsStore } from '../../types/cls';
import { IntegrationSecretCipher } from './integration-secret.cipher';
import { MailServerTester } from './mail-server.tester';
import { UserIntegrationService } from './user-integration.service';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<{ default: object }>();
  return { ...actual, default: { ...actual.default, post: vi.fn(), get: vi.fn() } };
});

describe('UserIntegrationService', () => {
  const encryptionKey = randomBytes(32).toString('base64');
  const integrationConfig = {
    encryptionKey,
    allowPrivateMailHosts: false,
    gmail: { clientId: 'gid', clientSecret: 'gsecret' },
    outlook: { clientId: undefined, clientSecret: undefined, tenant: 'common' },
  } as IIntegrationConfig;
  const baseConfig = { publicOrigin: 'https://app.example.com', secretKey: 's' } as IBaseConfig;
  const cipher = IntegrationSecretCipher.fromConfig(encryptionKey, 'unused');

  const prismaService = mockDeep<PrismaService>();
  const cls = mockDeep<ClsService<IClsStore>>();
  let cacheService: CacheService;
  let service: UserIntegrationService;
  let userId: string;

  const row = (overrides: Partial<UserIntegration> = {}): UserIntegration => ({
    id: 'uinA',
    userId: 'usrAlice',
    provider: UserIntegrationProvider.Gmail,
    name: 'Gmail (alice@example.com)',
    address: 'alice@example.com',
    secret: null,
    metadata: JSON.stringify({ userInfo: { email: 'alice@example.com', name: 'Alice' } }),
    status: 'active',
    lastUsedTime: null,
    connectedTime: new Date('2026-10-25T00:00:00Z'),
    createdTime: new Date('2026-10-25T00:00:00Z'),
    lastModifiedTime: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    userId = 'usrAlice';
    cls.get.mockImplementation(((key: string) =>
      key === 'user.id' ? userId : undefined) as never);
    prismaService.$tx.mockImplementation((async (fn: (p: PrismaService) => unknown) =>
      fn(prismaService)) as never);
    cacheService = new CacheService(new Keyv());
    service = new UserIntegrationService(
      prismaService,
      cls,
      cacheService,
      integrationConfig,
      baseConfig
    );
  });

  describe('list', () => {
    it("returns only the caller's integrations and never the secret", async () => {
      prismaService.userIntegration.findMany.mockResolvedValue([row({ secret: 'v1:x:y:z' })]);
      const { integrations } = await service.list();
      expect(prismaService.userIntegration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'usrAlice' } })
      );
      expect(integrations[0]).toMatchObject({ id: 'uinA', hasSecret: true, status: 'active' });
      expect(integrations[0]).not.toHaveProperty('secret');
    });
  });

  describe('ownership', () => {
    it("reports another user's integration as not found", async () => {
      prismaService.userIntegration.findFirst.mockResolvedValue(null);
      await expect(service.rename('uinB', 'x')).rejects.toMatchObject({ status: 404 });
      await expect(service.delete('uinB')).rejects.toMatchObject({ status: 404 });
      await expect(service.getAccessToken('uinB')).rejects.toMatchObject({ status: 404 });
      expect(prismaService.userIntegration.findFirst).toHaveBeenCalledWith({
        where: { id: 'uinB', userId: 'usrAlice' },
      });
    });

    it('rejects an empty name', async () => {
      await expect(service.rename('uinA', '   ')).rejects.toMatchObject({ status: 400 });
    });

    it('disconnects email sources when an integration is deleted', async () => {
      prismaService.userIntegration.findFirst.mockResolvedValue(row());
      await service.delete('uinA');
      expect(prismaService.emailSource.updateMany).toHaveBeenCalledWith({
        where: { integrationId: 'uinA', deletedTime: null },
        data: { status: 'disconnected' },
      });
      expect(prismaService.userIntegration.delete).toHaveBeenCalledWith({ where: { id: 'uinA' } });
    });
  });

  describe('OAuth', () => {
    const startAndGetState = async () => {
      const url = new URL(await service.startAuthorize('gmail', 'Work'));
      return { url, state: url.searchParams.get('state')! };
    };

    it('builds a PKCE consent URL with our callback', async () => {
      const { url } = await startAndGetState();
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/api/user-integrations/callback/gmail'
      );
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('access_type')).toBe('offline');
    });

    it('refuses providers that are not configured', async () => {
      await expect(service.startAuthorize('outlook')).rejects.toMatchObject({ status: 400 });
      await expect(service.startAuthorize('slack')).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a state started by another user', async () => {
      const { state } = await startAndGetState();
      userId = 'usrMallory';
      const result = await service.completeAuthorize('gmail', { code: 'c', state });
      expect(result.status).toBe('error');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('accepts a state only once', async () => {
      const { state } = await startAndGetState();
      await service.completeAuthorize('gmail', { error: 'access_denied', state });
      const again = await service.completeAuthorize('gmail', { code: 'c', state });
      expect(again).toMatchObject({ status: 'error', message: expect.stringContaining('expired') });
    });

    it('fails when Gmail access was unticked on the consent screen', async () => {
      const { state } = await startAndGetState();
      vi.mocked(axios.post).mockResolvedValue({
        data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid email' },
      });
      const result = await service.completeAuthorize('gmail', { code: 'c', state });
      expect(result).toMatchObject({
        status: 'error',
        message: expect.stringContaining('not granted'),
      });
      expect(prismaService.userIntegration.upsert).not.toHaveBeenCalled();
    });

    it('stores encrypted tokens keyed by the mailbox address', async () => {
      const { state } = await startAndGetState();
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
          scope: 'openid https://www.googleapis.com/auth/gmail.readonly',
        },
      });
      vi.mocked(axios.get).mockResolvedValue({
        data: { email: 'Alice@Example.com', name: 'Alice' },
      });
      prismaService.userIntegration.findUnique.mockResolvedValue(null);

      const result = await service.completeAuthorize('gmail', { code: 'c', state });

      expect(result.status).toBe('success');
      const args = prismaService.userIntegration.upsert.mock.calls[0][0];
      expect(args.where).toEqual({
        userId_provider_address: {
          userId: 'usrAlice',
          provider: 'gmail',
          address: 'alice@example.com',
        },
      });
      expect(args.create).toMatchObject({ name: 'Work', status: 'active' });
      const secret = args.create.secret as string;
      expect(secret).not.toContain('rt');
      expect(cipher.decrypt(secret, args.create.id as string)).toMatchObject({
        accessToken: 'at',
        refreshToken: 'rt',
      });
    });
  });

  describe('access tokens', () => {
    const withSecret = (expiresAt: number) =>
      row({
        secret: cipher.encrypt({ accessToken: 'old', refreshToken: 'rt', expiresAt }, 'uinA'),
      });

    it('returns a token that is still valid without refreshing', async () => {
      prismaService.userIntegration.findFirst.mockResolvedValue(withSecret(Date.now() + 3_600_000));
      await expect(service.getAccessToken('uinA')).resolves.toEqual({ accessToken: 'old' });
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('refreshes an expiring token and keeps the refresh token', async () => {
      prismaService.userIntegration.findFirst.mockResolvedValue(withSecret(Date.now() + 1000));
      vi.mocked(axios.post).mockResolvedValue({ data: { access_token: 'new', expires_in: 3600 } });
      await expect(service.getAccessToken('uinA')).resolves.toEqual({ accessToken: 'new' });
      const saved = prismaService.userIntegration.update.mock.calls[0][0].data.secret as string;
      expect(cipher.decrypt(saved, 'uinA')).toMatchObject({
        accessToken: 'new',
        refreshToken: 'rt',
      });
    });

    it('marks the integration for reconnection when the grant is revoked', async () => {
      prismaService.userIntegration.findFirst.mockResolvedValue(withSecret(0));
      vi.mocked(axios.post).mockRejectedValue(
        Object.assign(new Error('400'), {
          isAxiosError: true,
          response: { data: { error: 'invalid_grant' } },
        })
      );
      await expect(service.getAccessToken('uinA')).rejects.toMatchObject({ status: 424 });
      expect(prismaService.userIntegration.update).toHaveBeenCalledWith({
        where: { id: 'uinA' },
        data: { status: UserIntegrationStatus.NeedsReauth },
      });
      expect(prismaService.emailSource.updateMany).toHaveBeenCalled();
    });

    it('refuses IMAP integrations', async () => {
      prismaService.userIntegration.findFirst.mockResolvedValue(
        row({ provider: 'imap', secret: cipher.encrypt({ password: 'p' }, 'uinA') })
      );
      await expect(service.getAccessToken('uinA')).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('IMAP', () => {
    const imapRo = {
      email: 'Bob@Example.com',
      imap: { host: 'imap.example.com', port: 993, secure: true, username: 'bob', password: 'pw' },
    };

    it('saves after a successful test, with the password encrypted', async () => {
      const testImap = vi.spyOn(MailServerTester.prototype, 'testImap').mockResolvedValue();
      prismaService.userIntegration.findUnique.mockResolvedValue(null);

      const { id } = await service.createImap(imapRo);

      expect(testImap).toHaveBeenCalledWith(imapRo.imap);
      const args = prismaService.userIntegration.upsert.mock.calls[0][0];
      expect(args.create).toMatchObject({ id, provider: 'imap', address: 'bob@example.com' });
      expect(JSON.parse(args.create.metadata as string).imap).toEqual({
        host: 'imap.example.com',
        port: 993,
        secure: true,
        username: 'bob',
      });
      expect(args.create.metadata).not.toContain('pw');
      expect(cipher.decrypt(args.create.secret as string, id)).toEqual({ password: 'pw' });
    });

    it('tests SMTP with the IMAP password when none is given', async () => {
      vi.spyOn(MailServerTester.prototype, 'testImap').mockResolvedValue();
      const testSmtp = vi.spyOn(MailServerTester.prototype, 'testSmtp').mockResolvedValue();
      prismaService.userIntegration.findUnique.mockResolvedValue(null);
      const smtp = { host: 'smtp.example.com', port: 465, secure: true, username: 'bob' };

      await service.createImap({ ...imapRo, smtp });

      expect(testSmtp).toHaveBeenCalledWith({ ...smtp, password: 'pw' });
    });

    it('does not save when the login fails', async () => {
      vi.spyOn(MailServerTester.prototype, 'testImap').mockRejectedValue(
        Object.assign(new Error('auth'), { authenticationFailed: true })
      );
      await expect(service.createImap(imapRo)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Authentication failed'),
      });
      expect(prismaService.userIntegration.upsert).not.toHaveBeenCalled();
    });

    it('limits connection tests per user', async () => {
      vi.spyOn(MailServerTester.prototype, 'testImap').mockResolvedValue();
      for (let i = 0; i < 10; i++) {
        await service.testConnection({ imap: imapRo.imap });
      }
      await expect(service.testConnection({ imap: imapRo.imap })).rejects.toMatchObject({
        status: 429,
      });
    });
  });
});

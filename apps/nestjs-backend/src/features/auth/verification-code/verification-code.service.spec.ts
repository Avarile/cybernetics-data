/* eslint-disable sonarjs/no-duplicate-string */
import Keyv from 'keyv';
import { CacheService } from '../../../cache/cache.service';
import type { IAuthConfig } from '../../../configs/auth.config';
import { MAX_VERIFICATION_ATTEMPTS, VerificationCodeService } from './verification-code.service';

describe('VerificationCodeService', () => {
  let cacheService: CacheService;
  let service: VerificationCodeService;

  beforeEach(() => {
    cacheService = new CacheService(new Keyv());
    service = new VerificationCodeService(cacheService, {
      jwt: { secret: 'test-secret' },
    } as IAuthConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues an opaque token and a 6-digit code', async () => {
    const { token, code, expiresTime } = await service.issue('signup', { email: 'a@b.com' }, '10m');
    expect(code).toMatch(/^\d{6}$/);
    // not a JWT, and nothing in the token reveals the code or the email
    expect(token.split('.')).toHaveLength(1);
    expect(Buffer.from(token, 'base64url').toString('latin1')).not.toContain(code);
    expect(token).not.toContain(code);
    expect(new Date(expiresTime).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not store the plaintext code', async () => {
    const { token, code } = await service.issue('signup', { email: 'a@b.com' }, '10m');
    const entry = await cacheService.get(`verify-code:signup:${token}`);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain(code);
  });

  it('verifies a correct code once and returns the bound data', async () => {
    const { token, code } = await service.issue('change-email', { userId: 'usr1' }, '10m');
    await expect(service.verify('change-email', token, code)).resolves.toEqual({ userId: 'usr1' });
    await expect(service.verify('change-email', token, code)).rejects.toMatchObject({
      code: 'invalid_captcha',
    });
  });

  it('rejects a code issued for another purpose', async () => {
    const { token, code } = await service.issue('signup', { email: 'a@b.com' }, '10m');
    await expect(service.verify('change-email', token, code)).rejects.toMatchObject({
      code: 'invalid_captcha',
    });
    // the original purpose still works
    await expect(service.verify('signup', token, code)).resolves.toEqual({ email: 'a@b.com' });
  });

  it('counts wrong guesses and drops the entry at the limit', async () => {
    const { token, code } = await service.issue('2fa-signin', { userId: 'usr1' }, '10m');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_VERIFICATION_ATTEMPTS; i++) {
      await expect(service.verify('2fa-signin', token, wrong)).rejects.toThrow();
      const entry = await cacheService.get(`verify-code:2fa-signin:${token}`);
      expect(entry?.attempts).toBe(i);
    }
    await expect(service.verify('2fa-signin', token, wrong)).rejects.toThrow();
    expect(await cacheService.get(`verify-code:2fa-signin:${token}`)).toBeUndefined();
    // even the right code is useless now
    await expect(service.verify('2fa-signin', token, code)).rejects.toThrow();
  });

  it('rejects an expired code', async () => {
    vi.useFakeTimers();
    const { token, code } = await service.issue('2fa-setup', { userId: 'usr1' }, '10m');
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(service.verify('2fa-setup', token, code)).rejects.toMatchObject({
      code: 'invalid_captcha',
    });
  });

  it('rejects an unknown or empty token', async () => {
    await expect(service.verify('signup', 'nope', '123456')).rejects.toThrow();
    await expect(service.verify('signup', '', '123456')).rejects.toThrow();
  });

  it('peek returns data without counting an attempt, revoke removes it', async () => {
    const { token } = await service.issue(
      '2fa-signin',
      { userId: 'usr1', email: 'a@b.com' },
      '10m'
    );
    expect(await service.peek('2fa-signin', token)).toEqual({ userId: 'usr1', email: 'a@b.com' });
    expect((await cacheService.get(`verify-code:2fa-signin:${token}`))?.attempts).toBe(0);
    await service.revoke('2fa-signin', token);
    expect(await service.peek('2fa-signin', token)).toBeUndefined();
  });
});

/* eslint-disable sonarjs/no-duplicate-string */
import type { PrismaService } from '@teable/db-main-prisma';
import { EmailVerifyCodeType } from '@teable/openapi';
import Keyv from 'keyv';
import type { ClsService } from 'nestjs-cls';
import { mockDeep } from 'vitest-mock-extended';
import { CacheService } from '../../../cache/cache.service';
import type { IAuthConfig } from '../../../configs/auth.config';
import type { IThresholdConfig } from '../../../configs/threshold.config';
import type { IClsStore } from '../../../types/cls';
import type { MailSenderService } from '../../mail-sender/mail-sender.service';
import type { UserService } from '../../user/user.service';
import type { LocalAuthService } from '../local-auth/local-auth.service';
import { SigninLockoutService } from '../signin-lockout.service';
import { VerificationCodeService } from '../verification-code/verification-code.service';
import { maskEmail, TwoFactorService } from './two-factor.service';

describe('TwoFactorService', () => {
  const email = 'alice@example.com';
  const authConfig = {
    jwt: { secret: 'test-secret' },
    twoFactorCodeExpiresIn: '10m',
    signin: { maxLoginAttempts: 5, accountLockoutMinutes: 10 },
  } as unknown as IAuthConfig;
  const thresholdConfig = { twoFactorSendCodeMailRate: 0 } as IThresholdConfig;

  let cacheService: CacheService;
  let verificationCodeService: VerificationCodeService;
  let service: TwoFactorService;
  let issuedCodes: string[];
  let user: Record<string, unknown>;
  const userUpdate = vi.fn();
  const prismaService = mockDeep<PrismaService>();
  const userService = mockDeep<UserService>();
  const cls = mockDeep<ClsService<IClsStore>>();
  const localAuthService = mockDeep<LocalAuthService>();
  const mailSenderService = mockDeep<MailSenderService>();

  beforeEach(() => {
    vi.resetAllMocks();
    cacheService = new CacheService(new Keyv());
    verificationCodeService = new VerificationCodeService(cacheService, authConfig);
    issuedCodes = [];
    const issue = verificationCodeService.issue.bind(verificationCodeService);
    vi.spyOn(verificationCodeService, 'issue').mockImplementation(async (...args) => {
      const issued = await issue(...args);
      issuedCodes.push(issued.code);
      return issued;
    });

    user = {
      id: 'usrAlice',
      email,
      password: 'hash',
      twoFactorEmailEnabled: null,
      deactivatedTime: null,
      isSystem: null,
    };
    cls.get.mockImplementation(((key: string) =>
      key === 'user.id' ? user.id : undefined) as never);
    userService.getUserById.mockImplementation((async () => user) as never);
    prismaService.txClient.mockReturnValue({ user: { update: userUpdate } } as never);
    mailSenderService.checkSendMailRateLimit.mockImplementation(async (_options, fn) => fn());
    mailSenderService.sendEmailVerifyCodeEmailOptions.mockResolvedValue({
      subject: 's',
    } as never);
    mailSenderService.twoFactorChangedEmailOptions.mockResolvedValue({ subject: 'n' } as never);
    mailSenderService.sendMail.mockResolvedValue(true);
    localAuthService.validateUserByEmail.mockResolvedValue({ id: user.id } as never);

    service = new TwoFactorService(
      prismaService,
      userService,
      cls,
      localAuthService,
      verificationCodeService,
      mailSenderService,
      new SigninLockoutService(cacheService, authConfig),
      authConfig,
      thresholdConfig
    );
  });

  describe('maskEmail', () => {
    it('keeps the first and last character of the local part', () => {
      expect(maskEmail('alice@example.com')).toBe('a•••••e@example.com');
      expect(maskEmail('al@example.com')).toBe('a•••••@example.com');
    });
  });

  describe('sendSetupCode', () => {
    it('requires a password on the account', async () => {
      user.password = null;
      await expect(
        service.sendSetupCode({ action: 'enable', password: 'x' })
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('rejects enable when already on, and disable when off', async () => {
      user.twoFactorEmailEnabled = true;
      await expect(
        service.sendSetupCode({ action: 'enable', password: 'x' })
      ).rejects.toMatchObject({ code: 'conflict' });
      user.twoFactorEmailEnabled = null;
      await expect(
        service.sendSetupCode({ action: 'disable', password: 'x' })
      ).rejects.toMatchObject({ code: 'conflict' });
    });

    it('rejects a wrong password and counts it toward the lockout', async () => {
      localAuthService.validateUserByEmail.mockResolvedValue(null as never);
      await expect(
        service.sendSetupCode({ action: 'enable', password: 'wrong' })
      ).rejects.toMatchObject({ code: 'invalid_credentials' });
      expect(await cacheService.get(`signin:attempts:${email}`)).toBe(1);
      expect(mailSenderService.sendMail).not.toHaveBeenCalled();
    });

    it('emails a setup code to the current address', async () => {
      const res = await service.sendSetupCode({ action: 'enable', password: 'right' });
      expect(res.token).toBeTruthy();
      expect(mailSenderService.sendEmailVerifyCodeEmailOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EmailVerifyCodeType.TwoFactorSetup,
          action: 'enable',
          code: issuedCodes[0],
        })
      );
      expect(mailSenderService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: email }),
        expect.anything()
      );
    });

    it('revokes the code when the email cannot be sent', async () => {
      mailSenderService.sendMail.mockResolvedValue(false);
      await expect(
        service.sendSetupCode({ action: 'enable', password: 'right' })
      ).rejects.toMatchObject({ code: 'internal_server_error' });
      expect(issuedCodes).toHaveLength(1);
    });
  });

  describe('confirmSetup', () => {
    it('enables 2FA with a valid code and sends a notice', async () => {
      const { token } = await service.sendSetupCode({ action: 'enable', password: 'right' });
      await service.confirmSetup('enable', token, issuedCodes[0]);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'usrAlice', deletedTime: null },
        data: { twoFactorEmailEnabled: true, twoFactorEnabledTime: expect.any(String) },
      });
      expect(mailSenderService.twoFactorChangedEmailOptions).toHaveBeenCalledWith({
        to: email,
        enabled: true,
      });
    });

    it('disables 2FA with a valid code', async () => {
      user.twoFactorEmailEnabled = true;
      const { token } = await service.sendSetupCode({ action: 'disable', password: 'right' });
      await service.confirmSetup('disable', token, issuedCodes[0]);
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'usrAlice', deletedTime: null },
        data: { twoFactorEmailEnabled: null, twoFactorEnabledTime: null },
      });
    });

    it('rejects a code issued for the other action', async () => {
      user.twoFactorEmailEnabled = true;
      const { token } = await service.sendSetupCode({ action: 'disable', password: 'right' });
      await expect(service.confirmSetup('enable', token, issuedCodes[0])).rejects.toMatchObject({
        code: 'invalid_captcha',
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it("rejects another user's code", async () => {
      const { token } = await service.sendSetupCode({ action: 'enable', password: 'right' });
      user = { ...user, id: 'usrMallory' };
      await expect(service.confirmSetup('enable', token, issuedCodes[0])).rejects.toMatchObject({
        code: 'invalid_captcha',
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('rejects a wrong code', async () => {
      const { token } = await service.sendSetupCode({ action: 'enable', password: 'right' });
      const wrong = issuedCodes[0] === '000000' ? '111111' : '000000';
      await expect(service.confirmSetup('enable', token, wrong)).rejects.toMatchObject({
        code: 'invalid_captcha',
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });
  });

  describe('sign-in challenge', () => {
    it('creates a challenge with a masked email and emails the code', async () => {
      const challenge = await service.createSigninChallenge({ id: 'usrAlice', email });
      expect(challenge.maskedEmail).toBe('a•••••e@example.com');
      expect(challenge.challengeId).toBeTruthy();
      expect(mailSenderService.sendEmailVerifyCodeEmailOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EmailVerifyCodeType.TwoFactorSignin,
          code: issuedCodes[0],
        })
      );
    });

    it('completes with the right code and refreshes the sign-in time', async () => {
      const { challengeId } = await service.createSigninChallenge({ id: 'usrAlice', email });
      const signedIn = await service.completeSigninChallenge(challengeId, issuedCodes[0]);
      expect(signedIn).toMatchObject({ id: 'usrAlice' });
      expect(userService.refreshLastSignTime).toHaveBeenCalledWith('usrAlice');
      // single use
      await expect(
        service.completeSigninChallenge(challengeId, issuedCodes[0])
      ).rejects.toMatchObject({ code: 'invalid_captcha' });
    });

    it('counts a wrong code toward the sign-in lockout', async () => {
      const { challengeId } = await service.createSigninChallenge({ id: 'usrAlice', email });
      const wrong = issuedCodes[0] === '000000' ? '111111' : '000000';
      await expect(service.completeSigninChallenge(challengeId, wrong)).rejects.toMatchObject({
        code: 'invalid_captcha',
      });
      expect(await cacheService.get(`signin:attempts:${email}`)).toBe(1);
      expect(userService.refreshLastSignTime).not.toHaveBeenCalled();
    });

    it('locks the account after repeated wrong codes', async () => {
      await cacheService.set(`signin:attempts:${email}`, 4, 30);
      const { challengeId } = await service.createSigninChallenge({ id: 'usrAlice', email });
      const wrong = issuedCodes[0] === '000000' ? '111111' : '000000';
      await expect(service.completeSigninChallenge(challengeId, wrong)).rejects.toMatchObject({
        code: 'too_many_requests',
      });
      await expect(
        service.completeSigninChallenge(challengeId, issuedCodes[0])
      ).rejects.toMatchObject({ code: 'too_many_requests' });
    });

    it('rejects a deactivated user even with the right code', async () => {
      const { challengeId } = await service.createSigninChallenge({ id: 'usrAlice', email });
      user.deactivatedTime = new Date().toISOString();
      await expect(
        service.completeSigninChallenge(challengeId, issuedCodes[0])
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('marks an unknown challenge as expired', async () => {
      await expect(service.completeSigninChallenge('nope', '123456')).rejects.toMatchObject({
        code: 'invalid_captcha',
        data: expect.objectContaining({ expired: true }),
      });
    });

    it('resend replaces the challenge and revokes the old one', async () => {
      const first = await service.createSigninChallenge({ id: 'usrAlice', email });
      const second = await service.resendSigninChallenge(first.challengeId);
      expect(second.challengeId).not.toBe(first.challengeId);
      await expect(
        service.completeSigninChallenge(first.challengeId, issuedCodes[0])
      ).rejects.toMatchObject({ code: 'invalid_captcha' });
      await expect(
        service.completeSigninChallenge(second.challengeId, issuedCodes[1])
      ).resolves.toMatchObject({ id: 'usrAlice' });
    });
  });
});

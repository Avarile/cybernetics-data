/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { CacheService } from '../../../cache/cache.service';
import { GlobalModule } from '../../../global/global.module';
import { UserModule } from '../../user/user.module';
import { UserService } from '../../user/user.service';
import { LocalAuthService } from '../local-auth/local-auth.service';
import { SigninLockoutService } from '../signin-lockout.service';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  let localStrategy: LocalStrategy;
  const authService = mockDeep<LocalAuthService>();
  const cacheService = mockDeep<CacheService>();
  const twoFactorService = mockDeep<TwoFactorService>();
  let userService: UserService;
  const testEmail = 'test@test.com';
  const testPassword = '12345678a';
  const mokeReq = {
    ip: '127.0.0.1',
    connection: {
      remoteAddress: '127.0.0.1',
    },
    headers: {
      'x-forwarded-for': '127.0.0.1',
    },
  } as unknown as Request;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, UserModule],
      providers: [LocalStrategy, LocalAuthService, SigninLockoutService, TwoFactorService],
    })
      .overrideProvider(LocalAuthService)
      .useValue(authService)
      .overrideProvider(TwoFactorService)
      .useValue(twoFactorService)
      .overrideProvider(CacheService)
      .useValue(cacheService)
      .compile();

    localStrategy = module.get<LocalStrategy>(LocalStrategy);
    userService = module.get<UserService>(UserService);
  });

  afterEach(() => {
    vitest.resetAllMocks();
    mockReset(authService);
    mockReset(cacheService);
    mockReset(twoFactorService);
  });

  const lockoutConfig = () => {
    localStrategy['signinLockoutService']['authConfig'].signin = {
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
  };

  const validUser = (twoFactorEmailEnabled: boolean | null) =>
    ({
      id: 'usrTest',
      name: 'test',
      email: testEmail,
      password: 'hash',
      avatar: null,
      phone: null,
      notifyMeta: '{}',
      isAdmin: null,
      lang: null,
      deactivatedTime: null,
      twoFactorEmailEnabled,
      twoFactorEnabledTime: null,
    }) as unknown as Awaited<ReturnType<LocalAuthService['validateUserByEmailWithTurnstile']>>;

  it('signs in without a challenge when 2FA is off', async () => {
    lockoutConfig();
    authService.validateUserByEmailWithTurnstile.mockResolvedValue(validUser(null));
    const refresh = vi.spyOn(userService, 'refreshLastSignTime').mockResolvedValue();

    const result = await localStrategy.validate(mokeReq, testEmail, testPassword);

    expect(result).toMatchObject({ id: 'usrTest', twoFactor: { email: false } });
    expect(refresh).toHaveBeenCalledWith('usrTest');
    expect(twoFactorService.createSigninChallenge).not.toHaveBeenCalled();
  });

  it('throws TWO_FACTOR_REQUIRED without counting a failed attempt when 2FA is on', async () => {
    lockoutConfig();
    authService.validateUserByEmailWithTurnstile.mockResolvedValue(validUser(true));
    const refresh = vi.spyOn(userService, 'refreshLastSignTime').mockResolvedValue();
    const challenge = {
      challengeId: 'challenge',
      maskedEmail: 't•••••t@test.com',
      expiresTime: new Date().toISOString(),
    };
    twoFactorService.createSigninChallenge.mockResolvedValue(challenge);

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      code: 'two_factor_required',
      data: expect.objectContaining(challenge),
    });
    expect(cacheService.incr).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not count a failed attempt when the 2FA code email cannot be sent', async () => {
    lockoutConfig();
    authService.validateUserByEmailWithTurnstile.mockResolvedValue(validUser(true));
    twoFactorService.createSigninChallenge.mockRejectedValue(new Error('smtp down'));

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toThrow(
      'smtp down'
    );
    expect(cacheService.incr).not.toHaveBeenCalled();
  });

  it('should throw error when lockout is disabled', async () => {
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['signinLockoutService']['authConfig'].signin = {
      maxLoginAttempts: 0,
      accountLockoutMinutes: 0,
    };
    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toThrow(
      'Email or password is incorrect'
    );
  });

  it('should throw error when account is already locked', async () => {
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['signinLockoutService']['authConfig'].signin = {
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockImplementation(async (key) => {
      if (key === `signin:lockout:${testEmail}`) return true;
      return undefined;
    });

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toThrow(
      'Your account has been locked out, please try again after 10 minutes'
    );
  });

  it('should increment attempt count and throw error', async () => {
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['signinLockoutService']['authConfig'].signin = {
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockResolvedValue(undefined);
    cacheService.incr.mockResolvedValue(3);

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      response: 'Email or password is incorrect',
    });
    expect(cacheService.incr).toHaveBeenCalledWith(`signin:attempts:${testEmail}`, 30);
  });

  it('should lock account when max attempts reached', async () => {
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['signinLockoutService']['authConfig'].signin = {
      maxLoginAttempts: 4,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockResolvedValue(undefined);
    cacheService.incr.mockResolvedValue(4);

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      response: 'Your account has been locked out, please try again after 10 minutes',
    });
    expect(cacheService.set).toHaveBeenCalledWith(`signin:lockout:${testEmail}`, true, 10);
    expect(cacheService.del).toHaveBeenCalledWith(`signin:attempts:${testEmail}`);
  });

  it('should handle first failed attempt', async () => {
    authService.validateUserByEmail.mockRejectedValue(new Error());
    localStrategy['signinLockoutService']['authConfig'].signin = {
      maxLoginAttempts: 5,
      accountLockoutMinutes: 10,
    };
    cacheService.get.mockResolvedValue(undefined);
    cacheService.incr.mockResolvedValue(1);

    await expect(localStrategy.validate(mokeReq, testEmail, testPassword)).rejects.toMatchObject({
      response: 'Email or password is incorrect',
    });
    expect(cacheService.incr).toHaveBeenCalledWith(`signin:attempts:${testEmail}`, 30);
  });
});

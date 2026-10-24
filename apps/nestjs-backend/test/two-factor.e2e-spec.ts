/* eslint-disable sonarjs/no-duplicate-string */
import { HttpErrorCode } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  CreateAccessTokenVo,
  ITwoFactorChallenge,
  IUserInfoVo,
  IUserMeVo,
} from '@teable/openapi';
import {
  axios as openApiAxios,
  CREATE_ACCESS_TOKEN,
  SIGN_IN,
  SIGN_IN_TWO_FACTOR,
  SIGN_IN_TWO_FACTOR_RESEND,
  TWO_FACTOR_EMAIL_DISABLE,
  TWO_FACTOR_EMAIL_ENABLE,
  TWO_FACTOR_EMAIL_SEND_CODE,
  USER_INFO,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { vi } from 'vitest';
import { CacheService } from '../src/cache/cache.service';
import { VerificationCodeService } from '../src/features/auth/verification-code/verification-code.service';
import { MailSenderService } from '../src/features/mail-sender/mail-sender.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

describe('Two-factor authentication (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let codes: string[];
  // plain client: no session, never throws, so status and cookies can be checked
  let raw: AxiosInstance;

  const email = 'two-factor@test-two-factor.com';
  const password = '12345678a';

  beforeAll(async () => {
    process.env.BACKEND_TWO_FACTOR_SEND_CODE_MAIL_RATE = '0';
    process.env.SIGNIN_MAX_LOGIN_ATTEMPTS = '3';
    process.env.SIGNIN_ACCOUNT_LOCKOUT_MINUTES = '10';

    const appCtx = await initApp();
    app = appCtx.app;
    prismaService = app.get(PrismaService);
    raw = axios.create({ baseURL: openApiAxios.defaults.baseURL, validateStatus: () => true });
  });

  afterAll(async () => {
    await prismaService.user.deleteMany({ where: { email } });
    await app.close();
  });

  beforeEach(() => {
    // 2FA refuses to continue when the code email can't be sent; never reach a real SMTP server
    vi.spyOn(app.get(MailSenderService), 'sendMail').mockResolvedValue(true);
    // codes are only ever emailed, so read them where they are issued
    codes = [];
    const verificationCodeService = app.get(VerificationCodeService);
    const issue = verificationCodeService.issue.bind(verificationCodeService);
    vi.spyOn(verificationCodeService, 'issue').mockImplementation(async (...args) => {
      const issued = await issue(...args);
      codes.push(issued.code);
      return issued;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // lockout counters live in the app cache and would leak into the next test
    const cacheService = app.get(CacheService);
    await cacheService.del(`signin:attempts:${email}`);
    await cacheService.del(`signin:lockout:${email}`);
    await prismaService.user.deleteMany({ where: { email } });
  });

  const lastCode = () => codes[codes.length - 1];
  const wrongCode = () => (lastCode() === '000000' ? '111111' : '000000');

  const enableTwoFactor = async (userAxios: AxiosInstance) => {
    const sent = await userAxios.post(TWO_FACTOR_EMAIL_SEND_CODE, { action: 'enable', password });
    await userAxios.post(TWO_FACTOR_EMAIL_ENABLE, { token: sent.data.token, code: lastCode() });
  };

  const meWithCookie = (cookie: string[] | undefined) =>
    raw.get<IUserMeVo>(USER_ME, { headers: { Cookie: cookie ?? [] } });

  it('enable, sign in with a code, then disable', async () => {
    const userAxios = await createNewUserAxios({ email, password });
    const before = await userAxios.get<IUserMeVo>(USER_ME);
    expect(before.data.twoFactor).toEqual({ email: false, enabledTime: null });

    // the password is required to turn it on
    const wrongPassword = await getError(() =>
      userAxios.post(TWO_FACTOR_EMAIL_SEND_CODE, { action: 'enable', password: 'wrong1234' })
    );
    expect(wrongPassword?.code).toBe(HttpErrorCode.INVALID_CREDENTIALS);

    await enableTwoFactor(userAxios);
    const after = await userAxios.get<IUserMeVo>(USER_ME);
    expect(after.data.twoFactor?.email).toBe(true);
    expect(after.data.twoFactor?.enabledTime).toBeTruthy();

    // a correct password is no longer enough
    const signin = await raw.post(SIGN_IN, { email, password });
    expect(signin.status).toBe(422);
    expect(signin.data.code).toBe(HttpErrorCode.TWO_FACTOR_REQUIRED);
    const challenge = signin.data.data as ITwoFactorChallenge;
    expect(challenge.challengeId.split('.')).toHaveLength(1);
    expect(challenge.maskedEmail).toBe('t•••••r@test-two-factor.com');
    // no session yet: user/me allows anonymous, so it must not answer as this user
    const meDuringChallenge = await meWithCookie(signin.headers['set-cookie']);
    expect(meDuringChallenge.data.email).not.toBe(email);

    const wrong = await raw.post(SIGN_IN_TWO_FACTOR, {
      challengeId: challenge.challengeId,
      code: wrongCode(),
    });
    expect(wrong.status).toBe(400);
    expect(wrong.data.code).toBe(HttpErrorCode.INVALID_CAPTCHA);

    const ok = await raw.post<IUserMeVo>(SIGN_IN_TWO_FACTOR, {
      challengeId: challenge.challengeId,
      code: lastCode(),
    });
    expect(ok.status).toBe(200);
    expect(ok.data.email).toBe(email);
    const me = await meWithCookie(ok.headers['set-cookie']);
    expect(me.status).toBe(200);
    expect(me.data.email).toBe(email);

    // the code is single use
    const replay = await raw.post(SIGN_IN_TWO_FACTOR, {
      challengeId: challenge.challengeId,
      code: lastCode(),
    });
    expect(replay.status).toBe(400);

    // turn it off: password and code again
    const sent = await userAxios.post(TWO_FACTOR_EMAIL_SEND_CODE, { action: 'disable', password });
    await userAxios.post(TWO_FACTOR_EMAIL_DISABLE, { token: sent.data.token, code: lastCode() });
    expect((await userAxios.get<IUserMeVo>(USER_ME)).data.twoFactor?.email).toBe(false);

    const plain = await raw.post(SIGN_IN, { email, password });
    expect(plain.status).toBe(200);
    expect(plain.data.email).toBe(email);
  });

  it('rejects a setup code used for the other action', async () => {
    const userAxios = await createNewUserAxios({ email, password });
    const sent = await userAxios.post(TWO_FACTOR_EMAIL_SEND_CODE, { action: 'enable', password });
    const error = await getError(() =>
      userAxios.post(TWO_FACTOR_EMAIL_DISABLE, { token: sent.data.token, code: lastCode() })
    );
    expect(error?.code).toBe(HttpErrorCode.INVALID_CAPTCHA);
    expect((await userAxios.get<IUserMeVo>(USER_ME)).data.twoFactor?.email).toBe(false);
  });

  it('resend replaces the challenge', async () => {
    const userAxios = await createNewUserAxios({ email, password });
    await enableTwoFactor(userAxios);

    const signin = await raw.post(SIGN_IN, { email, password });
    const first = signin.data.data as ITwoFactorChallenge;
    const firstCode = lastCode();
    const resent = await raw.post<ITwoFactorChallenge>(SIGN_IN_TWO_FACTOR_RESEND, {
      challengeId: first.challengeId,
    });
    expect(resent.status).toBe(200);
    expect(resent.data.challengeId).not.toBe(first.challengeId);

    const old = await raw.post(SIGN_IN_TWO_FACTOR, {
      challengeId: first.challengeId,
      code: firstCode,
    });
    expect(old.status).toBe(400);
    const ok = await raw.post(SIGN_IN_TWO_FACTOR, {
      challengeId: resent.data.challengeId,
      code: lastCode(),
    });
    expect(ok.status).toBe(200);
  });

  it('wrong codes lock sign-in like wrong passwords', async () => {
    const userAxios = await createNewUserAxios({ email, password });
    await enableTwoFactor(userAxios);

    const signin = await raw.post(SIGN_IN, { email, password });
    const { challengeId } = signin.data.data as ITwoFactorChallenge;
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push(
        (await raw.post(SIGN_IN_TWO_FACTOR, { challengeId, code: wrongCode() })).status
      );
    }
    expect(statuses).toEqual([400, 400, 429]);
    // locked: even a fresh challenge and the right code are refused
    const again = await raw.post(SIGN_IN, { email, password });
    expect(again.status).toBe(422);
    const next = again.data.data as ITwoFactorChallenge;
    const blocked = await raw.post(SIGN_IN_TWO_FACTOR, {
      challengeId: next.challengeId,
      code: lastCode(),
    });
    expect(blocked.status).toBe(429);
  });

  it('personal access tokens keep working with 2FA on', async () => {
    const userAxios = await createNewUserAxios({ email, password });
    const token = await userAxios.post<CreateAccessTokenVo>(CREATE_ACCESS_TOKEN, {
      name: 'two-factor-e2e',
      scopes: ['user|email_read'],
      expiredTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString().slice(0, 10),
    });
    await enableTwoFactor(userAxios);

    const info = await raw.get<IUserInfoVo>(USER_INFO, {
      headers: { Authorization: `Bearer ${token.data.token}` },
    });
    expect(info.status).toBe(200);
    expect(info.data.email).toBe(email);
  });
});

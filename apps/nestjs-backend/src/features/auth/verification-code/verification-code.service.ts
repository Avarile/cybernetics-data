import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { HttpErrorCode } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import ms from 'ms';
import { CacheService } from '../../../cache/cache.service';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';
import { CustomHttpException } from '../../../custom.exception';

export type IVerificationPurpose = 'signup' | 'change-email' | '2fa-setup' | '2fa-signin';

export const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * Emailed one-time codes.
 *
 * The client only ever receives an opaque random token. The code itself is kept server side as an
 * HMAC bound to purpose and token, so it can't be read from the token (as it could from the JWTs
 * used before) and a leaked cache can't be brute-forced without the secret.
 */
@Injectable()
export class VerificationCodeService {
  constructor(
    private readonly cacheService: CacheService,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {}

  private cacheKey(purpose: IVerificationPurpose, token: string) {
    return `verify-code:${purpose}:${token}` as const;
  }

  private hashCode(purpose: IVerificationPurpose, token: string, code: string) {
    return createHmac('sha256', this.authConfig.jwt.secret)
      .update(`${purpose}:${token}:${code}`)
      .digest('hex');
  }

  private invalidCodeError() {
    return new CustomHttpException('Verification code is invalid', HttpErrorCode.INVALID_CAPTCHA, {
      localization: {
        i18nKey: 'httpErrors.auth.verificationCodeInvalid',
      },
    });
  }

  private expiredCodeError() {
    return new CustomHttpException(
      'Verification code is invalid or has expired',
      HttpErrorCode.INVALID_CAPTCHA,
      {
        localization: {
          i18nKey: 'httpErrors.auth.verificationCodeExpired',
        },
      }
    );
  }

  async issue<T extends Record<string, unknown>>(
    purpose: IVerificationPurpose,
    data: T,
    expiresIn: string
  ): Promise<{ token: string; code: string; expiresTime: string }> {
    const token = randomBytes(32).toString('base64url');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttlMs = ms(expiresIn);
    const expiresAt = Date.now() + ttlMs;
    await this.cacheService.setDetail(
      this.cacheKey(purpose, token),
      { codeHash: this.hashCode(purpose, token, code), attempts: 0, expiresAt, data },
      Math.ceil(ttlMs / 1000)
    );
    return { token, code, expiresTime: new Date(expiresAt).toISOString() };
  }

  /**
   * Check a code. Single use: the entry is removed on success, and after
   * MAX_VERIFICATION_ATTEMPTS wrong guesses.
   */
  async verify<T extends Record<string, unknown>>(
    purpose: IVerificationPurpose,
    token: string,
    code: string
  ): Promise<T> {
    const key = this.cacheKey(purpose, token);
    const entry = token ? await this.cacheService.get(key) : undefined;
    if (!entry || entry.expiresAt <= Date.now()) {
      throw this.expiredCodeError();
    }

    const expected = Buffer.from(entry.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(purpose, token, code ?? ''), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_VERIFICATION_ATTEMPTS) {
        await this.cacheService.del(key);
      } else {
        const remainingSeconds = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
        await this.cacheService.setDetail(key, { ...entry, attempts }, remainingSeconds);
      }
      throw this.invalidCodeError();
    }

    await this.cacheService.del(key);
    return entry.data as T;
  }

  /** Read what a live token is bound to, without counting an attempt. */
  async peek<T extends Record<string, unknown>>(
    purpose: IVerificationPurpose,
    token: string
  ): Promise<T | undefined> {
    if (!token) {
      return undefined;
    }
    const entry = await this.cacheService.get(this.cacheKey(purpose, token));
    if (!entry || entry.expiresAt <= Date.now()) {
      return undefined;
    }
    return entry.data as T;
  }

  async revoke(purpose: IVerificationPurpose, token: string) {
    await this.cacheService.del(this.cacheKey(purpose, token));
  }
}

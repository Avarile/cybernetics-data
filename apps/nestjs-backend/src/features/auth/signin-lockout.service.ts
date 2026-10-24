import { HttpErrorCode } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { AuthConfig, IAuthConfig } from '../../configs/auth.config';
import { CustomHttpException } from '../../custom.exception';

const incorrectCredentialsError = (attempts?: number) =>
  new CustomHttpException('Email or password is incorrect', HttpErrorCode.INVALID_CREDENTIALS, {
    ...(attempts === undefined ? {} : { attempts }),
    localization: {
      i18nKey: 'httpErrors.auth.emailOrPasswordIncorrect',
    },
  });

/**
 * Per-email lockout shared by every sign-in step (password, two-factor code) and by password
 * re-checks made from inside a session.
 */
@Injectable()
export class SigninLockoutService {
  constructor(
    private readonly cacheService: CacheService,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {}

  private lockError() {
    const { accountLockoutMinutes } = this.authConfig.signin;
    return new CustomHttpException(
      `Your account has been locked out, please try again after ${accountLockoutMinutes} minutes`,
      HttpErrorCode.TOO_MANY_REQUESTS,
      {
        minutes: accountLockoutMinutes,
        localization: {
          i18nKey: 'httpErrors.auth.accountLockedOut',
        },
      }
    );
  }

  private hasLockout() {
    const { maxLoginAttempts, accountLockoutMinutes } = this.authConfig.signin;
    return Boolean(maxLoginAttempts && accountLockoutMinutes);
  }

  async assertNotLocked(email: string) {
    if (this.hasLockout() && (await this.cacheService.get(`signin:lockout:${email}`))) {
      throw this.lockError();
    }
  }

  /**
   * Count a failed step for this email and throw what the user should see: the lockout error once
   * the limit is reached, otherwise `error` (by default "Email or password is incorrect").
   */
  async recordFailure(
    email: string,
    error: (attempts?: number) => CustomHttpException = incorrectCredentialsError
  ): Promise<never> {
    if (!this.hasLockout()) {
      throw error();
    }
    const { maxLoginAttempts = 0, accountLockoutMinutes } = this.authConfig.signin;
    if (await this.cacheService.get(`signin:lockout:${email}`)) {
      throw this.lockError();
    }
    // Use atomic increment to prevent race conditions
    const attempts = await this.cacheService.incr(`signin:attempts:${email}`, 30);
    if (attempts >= maxLoginAttempts) {
      await this.cacheService.set(`signin:lockout:${email}`, true, accountLockoutMinutes);
      await this.cacheService.del(`signin:attempts:${email}`);
      throw this.lockError();
    }
    throw error(attempts);
  }
}

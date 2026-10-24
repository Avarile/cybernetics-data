/* eslint-disable sonarjs/no-duplicate-string */
import { HttpErrorCode } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-local';
import { CustomHttpException } from '../../../custom.exception';
import { UserService } from '../../user/user.service';
import { LocalAuthService } from '../local-auth/local-auth.service';
import { SigninLockoutService } from '../signin-lockout.service';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { pickUserMe } from '../utils';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly userService: UserService,
    private readonly authService: LocalAuthService,
    private readonly signinLockoutService: SigninLockoutService,
    private readonly twoFactorService: TwoFactorService
  ) {
    super({
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, email: string, password: string) {
    const user = await this.validatePassword(req, email, password);

    // Outside the lockout handling below: a correct password must not count as a failed attempt.
    // Throwing here means LocalAuthGuard never logs the user in, so no session exists yet.
    if (user.twoFactorEmailEnabled) {
      const challenge = await this.twoFactorService.createSigninChallenge(user);
      throw new CustomHttpException(
        'Two-factor authentication required',
        HttpErrorCode.TWO_FACTOR_REQUIRED,
        {
          ...challenge,
          localization: {
            i18nKey: 'httpErrors.auth.twoFactorRequired',
          },
        }
      );
    }

    await this.userService.refreshLastSignTime(user.id);
    return pickUserMe(user);
  }

  private async validatePassword(req: Request, email: string, password: string) {
    try {
      const turnstileToken = req.body?.turnstileToken;
      const remoteIp =
        req.ip || req.connection.remoteAddress || (req.headers['x-forwarded-for'] as string);
      const user = await this.authService.validateUserByEmailWithTurnstile(
        email,
        password,
        turnstileToken,
        remoteIp
      );
      if (!user) {
        throw new CustomHttpException(
          'Email or password is incorrect',
          HttpErrorCode.INVALID_CREDENTIALS,
          {
            localization: {
              i18nKey: 'httpErrors.auth.emailOrPasswordIncorrect',
            },
          }
        );
      }
      if (user.deactivatedTime) {
        throw new CustomHttpException(
          `Your account has been deactivated by the administrator`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.auth.accountDeactivated',
            },
          }
        );
      }
      return user;
    } catch {
      return await this.signinLockoutService.recordFailure(email);
    }
  }
}

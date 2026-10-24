/* eslint-disable sonarjs/no-duplicate-string */
import { HttpErrorCode } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { EmailVerifyCodeType, MailTransporterType, MailType } from '@teable/openapi';
import type {
  ITwoFactorChallenge,
  ITwoFactorEmailSendCodeRo,
  ITwoFactorEmailSendCodeVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { MailSenderService } from '../../mail-sender/mail-sender.service';
import { UserService } from '../../user/user.service';
import { LocalAuthService } from '../local-auth/local-auth.service';
import { SigninLockoutService } from '../signin-lockout.service';
import { VerificationCodeService } from '../verification-code/verification-code.service';

type ITwoFactorAction = ITwoFactorEmailSendCodeRo['action'];

interface ISetupCodeData extends Record<string, unknown> {
  userId: string;
  action: ITwoFactorAction;
}

interface ISigninChallengeData extends Record<string, unknown> {
  userId: string;
  email: string;
}

export const maskEmail = (email: string) => {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return email;
  }
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) {
    return `${local[0]}•••••${domain}`;
  }
  return `${local[0]}•••••${local[local.length - 1]}${domain}`;
};

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly cls: ClsService<IClsStore>,
    private readonly localAuthService: LocalAuthService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly mailSenderService: MailSenderService,
    private readonly signinLockoutService: SigninLockoutService,
    @AuthConfig() private readonly authConfig: IAuthConfig,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  private sendCodeFailedError() {
    return new CustomHttpException(
      'Failed to send the two-factor code',
      HttpErrorCode.INTERNAL_SERVER_ERROR,
      {
        localization: {
          i18nKey: 'httpErrors.auth.sendTwoFactorCodeFailed',
        },
      }
    );
  }

  private async getCurrentUserOrThrow() {
    const user = await this.userService.getUserById(this.cls.get('user.id'));
    if (!user) {
      throw new CustomHttpException(`User not found`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.user.notFound',
        },
      });
    }
    return user;
  }

  private async sendCode(
    to: string,
    code: string,
    payload:
      | { type: EmailVerifyCodeType.TwoFactorSignin }
      | { type: EmailVerifyCodeType.TwoFactorSetup; action: ITwoFactorAction }
  ) {
    const emailOptions = await this.mailSenderService.sendEmailVerifyCodeEmailOptions({
      ...payload,
      code,
      expiresIn: this.authConfig.twoFactorCodeExpiresIn,
    });
    const sent = await this.mailSenderService.sendMail(
      { to, ...emailOptions },
      { type: MailType.VerifyCode, transporterName: MailTransporterType.Notify }
    );
    if (!sent) {
      throw this.sendCodeFailedError();
    }
  }

  /** Step 1 of turning email two-factor authentication on or off from the settings dialog. */
  async sendSetupCode({
    action,
    password,
  }: ITwoFactorEmailSendCodeRo): Promise<ITwoFactorEmailSendCodeVo> {
    const user = await this.getCurrentUserOrThrow();
    if (!user.password) {
      throw new CustomHttpException(`Password is not set`, HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.auth.passwordNotSet',
        },
      });
    }
    this.assertActionAllowed(action, Boolean(user.twoFactorEmailEnabled));
    await this.signinLockoutService.assertNotLocked(user.email);

    return await this.mailSenderService.checkSendMailRateLimit(
      {
        email: user.email,
        rateLimitKey: 'two-factor-setup',
        rateLimit: this.thresholdConfig.twoFactorSendCodeMailRate,
      },
      async () => {
        const valid = await this.localAuthService
          .validateUserByEmail(user.email, password)
          .catch(() => null);
        if (!valid) {
          // wrong passwords here count toward the sign-in lockout, so a stolen session can't be
          // used to guess the password
          await this.signinLockoutService.recordFailure(
            user.email,
            () =>
              new CustomHttpException('Password is incorrect', HttpErrorCode.INVALID_CREDENTIALS, {
                localization: {
                  i18nKey: 'httpErrors.auth.passwordIncorrect',
                },
              })
          );
        }
        const { token, code, expiresTime } =
          await this.verificationCodeService.issue<ISetupCodeData>(
            '2fa-setup',
            { userId: user.id, action },
            this.authConfig.twoFactorCodeExpiresIn
          );
        try {
          await this.sendCode(user.email, code, {
            type: EmailVerifyCodeType.TwoFactorSetup,
            action,
          });
        } catch (error) {
          await this.verificationCodeService.revoke('2fa-setup', token);
          throw error;
        }
        return { token, expiresTime };
      }
    );
  }

  private assertActionAllowed(action: ITwoFactorAction, enabled: boolean) {
    if (action === 'enable' && enabled) {
      throw new CustomHttpException(
        'Two-factor authentication is already enabled',
        HttpErrorCode.CONFLICT,
        {
          localization: {
            i18nKey: 'httpErrors.auth.twoFactorAlreadyEnabled',
          },
        }
      );
    }
    if (action === 'disable' && !enabled) {
      throw new CustomHttpException(
        'Two-factor authentication is not enabled',
        HttpErrorCode.CONFLICT,
        {
          localization: {
            i18nKey: 'httpErrors.auth.twoFactorNotEnabled',
          },
        }
      );
    }
  }

  /** Step 2 of the settings dialog: check the code and flip the flag. */
  async confirmSetup(action: ITwoFactorAction, token: string, code: string) {
    const userId = this.cls.get('user.id');
    const data = await this.verificationCodeService.verify<ISetupCodeData>(
      '2fa-setup',
      token,
      code
    );
    if (data.userId !== userId || data.action !== action) {
      throw new CustomHttpException('Verification code is invalid', HttpErrorCode.INVALID_CAPTCHA, {
        localization: {
          i18nKey: 'httpErrors.auth.verificationCodeInvalid',
        },
      });
    }
    const user = await this.getCurrentUserOrThrow();
    const enable = action === 'enable';
    this.assertActionAllowed(action, Boolean(user.twoFactorEmailEnabled));

    await this.prismaService.txClient().user.update({
      where: { id: userId, deletedTime: null },
      data: enable
        ? { twoFactorEmailEnabled: true, twoFactorEnabledTime: new Date().toISOString() }
        : { twoFactorEmailEnabled: null, twoFactorEnabledTime: null },
    });

    // a notice, not part of the change: a failure is logged by sendMail and ignored
    const noticeOptions = await this.mailSenderService.twoFactorChangedEmailOptions({
      to: user.email,
      enabled: enable,
    });
    void this.mailSenderService.sendMail(
      { to: user.email, ...noticeOptions },
      { type: MailType.System, transporterName: MailTransporterType.Notify }
    );
  }

  /** Called by the local strategy once the password is correct. Emails a code, no session yet. */
  async createSigninChallenge(user: { id: string; email: string }): Promise<ITwoFactorChallenge> {
    return await this.mailSenderService.checkSendMailRateLimit(
      {
        email: user.email,
        rateLimitKey: 'two-factor-signin',
        rateLimit: this.thresholdConfig.twoFactorSendCodeMailRate,
      },
      async () => {
        const { token, code, expiresTime } =
          await this.verificationCodeService.issue<ISigninChallengeData>(
            '2fa-signin',
            { userId: user.id, email: user.email },
            this.authConfig.twoFactorCodeExpiresIn
          );
        try {
          await this.sendCode(user.email, code, { type: EmailVerifyCodeType.TwoFactorSignin });
        } catch (error) {
          await this.verificationCodeService.revoke('2fa-signin', token);
          throw error;
        }
        return { challengeId: token, maskedEmail: maskEmail(user.email), expiresTime };
      }
    );
  }

  private challengeExpiredError() {
    return new CustomHttpException(
      'Verification code is invalid or has expired',
      HttpErrorCode.INVALID_CAPTCHA,
      {
        expired: true,
        localization: {
          i18nKey: 'httpErrors.auth.verificationCodeExpired',
        },
      }
    );
  }

  async resendSigninChallenge(challengeId: string): Promise<ITwoFactorChallenge> {
    const data = await this.verificationCodeService.peek<ISigninChallengeData>(
      '2fa-signin',
      challengeId
    );
    if (!data) {
      throw this.challengeExpiredError();
    }
    const challenge = await this.createSigninChallenge({ id: data.userId, email: data.email });
    await this.verificationCodeService.revoke('2fa-signin', challengeId);
    return challenge;
  }

  /**
   * Check a sign-in code. Wrong codes count toward the same per-email lockout as wrong passwords.
   * Returns the user to log in.
   */
  async completeSigninChallenge(challengeId: string, code: string) {
    const data = await this.verificationCodeService.peek<ISigninChallengeData>(
      '2fa-signin',
      challengeId
    );
    if (!data) {
      throw this.challengeExpiredError();
    }
    await this.signinLockoutService.assertNotLocked(data.email);

    try {
      await this.verificationCodeService.verify('2fa-signin', challengeId, code);
    } catch (error) {
      if (error instanceof CustomHttpException) {
        const failure = error;
        await this.signinLockoutService.recordFailure(data.email, () => failure);
      }
      throw error;
    }

    const user = await this.userService.getUserById(data.userId);
    if (!user || user.deactivatedTime || user.isSystem) {
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
    await this.userService.refreshLastSignTime(user.id);
    return user;
  }
}

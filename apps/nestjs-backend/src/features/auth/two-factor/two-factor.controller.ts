import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { ITwoFactorChallenge, ITwoFactorEmailSendCodeVo, IUserMeVo } from '@teable/openapi';
import {
  ISigninTwoFactorResendRo,
  ISigninTwoFactorRo,
  ITwoFactorEmailConfirmRo,
  ITwoFactorEmailSendCodeRo,
  signinTwoFactorResendRoSchema,
  signinTwoFactorRoSchema,
  twoFactorEmailConfirmRoSchema,
  twoFactorEmailSendCodeRoSchema,
} from '@teable/openapi';
import { Request } from 'express';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Public } from '../decorators/public.decorator';
import { pickUserMe } from '../utils';
import { TwoFactorService } from './two-factor.service';

@Controller('api/auth')
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  @Post('two-factor/email/send-code')
  @HttpCode(200)
  async sendCode(
    @Body(new ZodValidationPipe(twoFactorEmailSendCodeRoSchema)) body: ITwoFactorEmailSendCodeRo
  ): Promise<ITwoFactorEmailSendCodeVo> {
    return this.twoFactorService.sendSetupCode(body);
  }

  @Post('two-factor/email/enable')
  @HttpCode(200)
  async enable(
    @Body(new ZodValidationPipe(twoFactorEmailConfirmRoSchema)) body: ITwoFactorEmailConfirmRo
  ): Promise<void> {
    await this.twoFactorService.confirmSetup('enable', body.token, body.code);
  }

  @Post('two-factor/email/disable')
  @HttpCode(200)
  async disable(
    @Body(new ZodValidationPipe(twoFactorEmailConfirmRoSchema)) body: ITwoFactorEmailConfirmRo
  ): Promise<void> {
    await this.twoFactorService.confirmSetup('disable', body.token, body.code);
  }

  @Public()
  @Post('signin/two-factor')
  @HttpCode(200)
  async signinTwoFactor(
    @Body(new ZodValidationPipe(signinTwoFactorRoSchema)) body: ISigninTwoFactorRo,
    @Req() req: Request
  ): Promise<IUserMeVo> {
    const user = pickUserMe(
      await this.twoFactorService.completeSigninChallenge(body.challengeId, body.code)
    );
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    return user;
  }

  @Public()
  @Post('signin/two-factor/resend')
  @HttpCode(200)
  async resend(
    @Body(new ZodValidationPipe(signinTwoFactorResendRoSchema)) body: ISigninTwoFactorResendRo
  ): Promise<ITwoFactorChallenge> {
    return this.twoFactorService.resendSigninChallenge(body.challengeId);
  }
}

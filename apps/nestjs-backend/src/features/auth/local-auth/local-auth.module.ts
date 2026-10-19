import { Module } from '@nestjs/common';
import { MailSenderModule } from '../../mail-sender/mail-sender.module';
import { SettingModule } from '../../setting/setting.module';
import { UserModule } from '../../user/user.module';
import { SessionStoreService } from '../session/session-store.service';
import { SessionModule } from '../session/session.module';
import { SigninLockoutService } from '../signin-lockout.service';
import { LocalStrategy } from '../strategies/local.strategy';
import { TurnstileModule } from '../turnstile/turnstile.module';
import { TwoFactorController } from '../two-factor/two-factor.controller';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { VerificationCodeModule } from '../verification-code/verification-code.module';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';

@Module({
  imports: [
    TurnstileModule,
    SettingModule,
    UserModule,
    SessionModule,
    MailSenderModule.register(),
    VerificationCodeModule,
  ],
  providers: [
    LocalStrategy,
    LocalAuthService,
    SessionStoreService,
    SigninLockoutService,
    TwoFactorService,
  ],
  controllers: [LocalAuthController, TwoFactorController],
  exports: [LocalAuthService],
})
export class LocalAuthModule {}

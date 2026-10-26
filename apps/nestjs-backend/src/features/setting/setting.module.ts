import { Module } from '@nestjs/common';
import { ProviderMigrationService } from './provider-migration.service';
import { ProviderSecretService } from './provider-secret.service';
import { SettingService } from './setting.service';

@Module({
  imports: [],
  exports: [SettingService, ProviderSecretService],
  providers: [SettingService, ProviderSecretService, ProviderMigrationService],
})
export class SettingModule {}

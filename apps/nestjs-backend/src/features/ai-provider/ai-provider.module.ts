import { Module } from '@nestjs/common';
import { SettingOpenApiModule } from '../setting/open-api/setting-open-api.module';
import { SettingModule } from '../setting/setting.module';
import { AiProviderTestService } from './ai-provider-test.service';
import { AiProviderController } from './ai-provider.controller';
import { AiProviderService } from './ai-provider.service';
import { ProviderUsageRegistry } from './provider-usage';

@Module({
  imports: [SettingModule, SettingOpenApiModule],
  controllers: [AiProviderController],
  providers: [AiProviderService, AiProviderTestService, ProviderUsageRegistry],
  exports: [AiProviderService, ProviderUsageRegistry],
})
export class AiProviderModule {}

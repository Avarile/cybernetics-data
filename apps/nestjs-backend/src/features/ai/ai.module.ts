import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiDataModule } from '../ai-data/ai-data.module';
import { ChatFileModule } from '../chat-file/chat-file.module';
import { SettingModule } from '../setting/setting.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import {
  AiConfigService,
  GatewayModelService,
  GenerationService,
  MastraClientService,
  ModelCapabilityService,
  ModelResolverService,
  TtsService,
} from './service';

const subServices = [
  AiConfigService,
  GatewayModelService,
  ModelResolverService,
  ModelCapabilityService,
  GenerationService,
  MastraClientService,
  TtsService,
];

@Module({
  imports: [ConfigModule, SettingModule, ChatFileModule, AiDataModule],
  controllers: [AiController],
  providers: [AiService, ...subServices],
  exports: [AiService],
})
export class AiModule {}

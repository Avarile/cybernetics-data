import { Module } from '@nestjs/common';
import { UserIntegrationController } from './user-integration.controller';
import { UserIntegrationService } from './user-integration.service';

@Module({
  controllers: [UserIntegrationController],
  providers: [UserIntegrationService],
  exports: [UserIntegrationService],
})
export class UserIntegrationModule {}

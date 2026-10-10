import { Module } from '@nestjs/common';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordModule } from '../record/record.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { AiDataAuditService } from './ai-data-audit.service';
import { AiDataContextService } from './ai-data-context.service';
import { AiDataInternalController } from './ai-data-internal.controller';
import { AiDataInternalGuard } from './ai-data-internal.guard';
import { AiDataService } from './ai-data.service';

/**
 * Read-only, user-scoped data access for AI agents.
 * PermissionModule is @Global() and exports PermissionService, so it is injected
 * without being imported (same as McpModule). CacheModule and PrismaModule are global too.
 */
@Module({
  imports: [TableOpenApiModule, FieldOpenApiModule, RecordModule],
  controllers: [AiDataInternalController],
  providers: [AiDataService, AiDataAuditService, AiDataContextService, AiDataInternalGuard],
  exports: [AiDataService, AiDataContextService],
})
export class AiDataModule {}

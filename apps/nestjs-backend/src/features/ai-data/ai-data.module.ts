import { Module } from '@nestjs/common';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordModule } from '../record/record.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { AiDataAuditService } from './ai-data-audit.service';
import { AiDataService } from './ai-data.service';

/**
 * Read-only, user-scoped data access for AI agents.
 * PermissionModule is @Global() and exports PermissionService, so it is injected
 * without being imported (same as McpModule). CacheModule and PrismaModule are global too.
 */
@Module({
  imports: [TableOpenApiModule, FieldOpenApiModule, RecordModule],
  providers: [AiDataService, AiDataAuditService],
  exports: [AiDataService],
})
export class AiDataModule {}

import { Module } from '@nestjs/common';
import { BaseModule } from '../base/base.module';
import { BaseGraphModule } from '../base-graph/base-graph.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SpaceModule } from '../space/space.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { ViewModule } from '../view/view.module';
import { McpController } from './mcp.controller';
import { McpManifestController } from './mcp.manifest.controller';
import { McpService } from './mcp.service';
import { McpToolRegistry } from './tool-registry';

/**
 * PermissionModule is @Global() and exports PermissionService
 * (permission.module.ts:7,21), so it is injected without being imported —
 * the same way TrashModule does it.
 */
@Module({
  imports: [
    SpaceModule,
    BaseModule,
    TableOpenApiModule,
    FieldOpenApiModule,
    RecordOpenApiModule,
    RecordModule,
    ViewModule,
    ViewOpenApiModule,
    BaseGraphModule,
  ],
  controllers: [McpController, McpManifestController],
  providers: [McpService, McpToolRegistry],
})
export class McpModule {}

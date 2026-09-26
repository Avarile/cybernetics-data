import { Module } from '@nestjs/common';
import { RecordModule } from '../record/record.module';
import { BaseGraphController } from './base-graph.controller';
import { BaseGraphService } from './base-graph.service';
import { GraphEtagService } from './graph-etag.service';
import { GraphNodeService } from './graph-node.service';
import { GraphPlanResolver } from './graph-plan.resolver';
import { GraphRowReader } from './graph-row.reader';

/**
 * PermissionService, CacheService, PrismaService and the data knex are all
 * provided globally, so RecordModule is the only import.
 */
@Module({
  imports: [RecordModule],
  controllers: [BaseGraphController],
  providers: [
    BaseGraphService,
    GraphNodeService,
    GraphPlanResolver,
    GraphRowReader,
    GraphEtagService,
  ],
  exports: [BaseGraphService, GraphNodeService],
})
export class BaseGraphModule {}

import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BaseModule } from '../base/base.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SchemaPackModule } from '../schema-pack/schema-pack.module';
import { SettingModule } from '../setting/setting.module';
import { SpaceModule } from '../space/space.module';
import { AgentSeeder } from './application/installation/agent-seeder';
import { EnsureInstallation } from './application/installation/ensure-installation.usecase';
import { AgentMembershipService } from './application/installation/membership';
import { AUDIT_PORT, MODEL_PORT } from './domain/ports';
import { PrismaAuditLog } from './infrastructure/audit/prisma-audit-log';
import { AgentExecutionContext } from './infrastructure/execution-context';
import { ProviderModelAdapter } from './infrastructure/llm/provider-model.adapter';
import { AgentAdminGuard } from './interface/agent-admin.guard';

/**
 * Composition root of the admin-only agent (design §5): binds the domain ports to their adapters.
 * Layers: interface → application → domain ← infrastructure.
 */
@Module({
  imports: [
    AiModule,
    SettingModule,
    SchemaPackModule,
    SpaceModule,
    BaseModule,
    FieldOpenApiModule,
    RecordModule,
    RecordOpenApiModule,
  ],
  providers: [
    AgentExecutionContext,
    AgentMembershipService,
    AgentSeeder,
    EnsureInstallation,
    AgentAdminGuard,
    { provide: MODEL_PORT, useClass: ProviderModelAdapter },
    { provide: AUDIT_PORT, useClass: PrismaAuditLog },
  ],
  exports: [AgentExecutionContext, AgentAdminGuard, EnsureInstallation, MODEL_PORT, AUDIT_PORT],
})
export class AgentModule {}

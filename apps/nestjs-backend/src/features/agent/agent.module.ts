import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SettingModule } from '../setting/setting.module';
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
  imports: [AiModule, SettingModule],
  providers: [
    AgentExecutionContext,
    AgentAdminGuard,
    { provide: MODEL_PORT, useClass: ProviderModelAdapter },
    { provide: AUDIT_PORT, useClass: PrismaAuditLog },
  ],
  exports: [AgentExecutionContext, AgentAdminGuard, MODEL_PORT, AUDIT_PORT],
})
export class AgentModule {}

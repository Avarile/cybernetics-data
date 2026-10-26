import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BaseModule } from '../base/base.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SchemaPackModule } from '../schema-pack/schema-pack.module';
import { SettingModule } from '../setting/setting.module';
import { SpaceModule } from '../space/space.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { CancelRun } from './application/chat/cancel-run.usecase';
import { ResumeTurn } from './application/chat/resume-turn.usecase';
import { RunTurn } from './application/chat/run-turn.usecase';
import { TurnGate } from './application/chat/turn-gate';
import { AgentSeeder } from './application/installation/agent-seeder';
import { EnsureInstallation } from './application/installation/ensure-installation.usecase';
import { AgentExposureService } from './application/installation/exposure';
import { AgentMembershipService } from './application/installation/membership';
import { AgentStatusQuery } from './application/status/agent-status.query';
import { ManageThreads } from './application/threads/manage-threads.usecase';
import {
  AGENT_LAYOUT_PORT,
  AGENT_STORE_PORT,
  AUDIT_PORT,
  MODEL_PORT,
  RUN_STORE_PORT,
} from './domain/ports';
import { PrismaAuditLog } from './infrastructure/audit/prisma-audit-log';
import { AgentExecutionContext } from './infrastructure/execution-context';
import { ProviderModelAdapter } from './infrastructure/llm/provider-model.adapter';
import { PrismaRunStore } from './infrastructure/runs/prisma-run-store';
import { RunRegistry } from './infrastructure/runs/run-registry';
import { AgentTableStore } from './infrastructure/store/agent-table-store';
import { AgentAdminGuard } from './interface/agent-admin.guard';
import { AgentChatController } from './interface/agent-chat.controller';
import { AgentLifecycleController } from './interface/agent-lifecycle.controller';
import { AgentRuntime } from './runtime/agent-runtime';
import { ContextBuilder } from './runtime/context-builder';
import { ToolAssembler } from './runtime/tool-assembler';
import { ToolkitRegistry } from './toolkits/toolkit.registry';

/**
 * Composition root of the admin-only agent (design §5): binds the domain ports to their adapters.
 * Layers: interface → application → domain ← infrastructure.
 */
@Module({
  controllers: [AgentLifecycleController, AgentChatController],
  imports: [
    AiModule,
    SettingModule,
    SchemaPackModule,
    SpaceModule,
    BaseModule,
    FieldOpenApiModule,
    RecordModule,
    RecordOpenApiModule,
    ViewOpenApiModule,
  ],
  providers: [
    AgentExecutionContext,
    AgentMembershipService,
    AgentSeeder,
    AgentExposureService,
    EnsureInstallation,
    AgentStatusQuery,
    ToolkitRegistry,
    ToolAssembler,
    ContextBuilder,
    AgentRuntime,
    RunRegistry,
    TurnGate,
    RunTurn,
    ResumeTurn,
    CancelRun,
    ManageThreads,
    AgentAdminGuard,
    { provide: MODEL_PORT, useClass: ProviderModelAdapter },
    { provide: AUDIT_PORT, useClass: PrismaAuditLog },
    { provide: AGENT_LAYOUT_PORT, useExisting: EnsureInstallation },
    { provide: AGENT_STORE_PORT, useClass: AgentTableStore },
    { provide: RUN_STORE_PORT, useClass: PrismaRunStore },
  ],
  exports: [
    AgentExecutionContext,
    AgentAdminGuard,
    EnsureInstallation,
    MODEL_PORT,
    AUDIT_PORT,
    AGENT_STORE_PORT,
  ],
})
export class AgentModule {}

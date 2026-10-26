import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { AggregationOpenApiModule } from '../aggregation/open-api/aggregation-open-api.module';
import { AiModule } from '../ai/ai.module';
import { AiDataModule } from '../ai-data/ai-data.module';
import { BaseModule } from '../base/base.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SchemaPackModule } from '../schema-pack/schema-pack.module';
import { SettingModule } from '../setting/setting.module';
import { SpaceModule } from '../space/space.module';
import { TrashModule } from '../trash/trash.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { ConfigureAgent } from './application/admin/configure-agent.usecase';
import { CancelRun } from './application/chat/cancel-run.usecase';
import { ResumeTurn } from './application/chat/resume-turn.usecase';
import { RunTurn } from './application/chat/run-turn.usecase';
import { TurnGate } from './application/chat/turn-gate';
import { AgentSeeder } from './application/installation/agent-seeder';
import { EnsureInstallation } from './application/installation/ensure-installation.usecase';
import { AgentExposureService } from './application/installation/exposure';
import { AgentMembershipService } from './application/installation/membership';
import { AGENT_JOBS_QUEUE, AgentJobs } from './application/jobs/agent-jobs';
import { TurnJobs } from './application/jobs/turn-jobs';
import { AgentStatusQuery } from './application/status/agent-status.query';
import { ManageThreads } from './application/threads/manage-threads.usecase';
import {
  AGENT_LAYOUT_PORT,
  AGENT_STORE_PORT,
  AUDIT_PORT,
  DATA_GATEWAY_PORT,
  MODEL_PORT,
  RUN_STORE_PORT,
} from './domain/ports';
import { PrismaAuditLog } from './infrastructure/audit/prisma-audit-log';
import { UnrestrictedDataGateway } from './infrastructure/data/unrestricted-data-gateway';
import { AgentExecutionContext } from './infrastructure/execution-context';
import { AgentJobsProcessor } from './infrastructure/jobs/agent-jobs.processor';
import { ProviderModelAdapter } from './infrastructure/llm/provider-model.adapter';
import { PrismaRunStore } from './infrastructure/runs/prisma-run-store';
import { RunRegistry } from './infrastructure/runs/run-registry';
import { AgentTableStore } from './infrastructure/store/agent-table-store';
import { AgentAdminGuard } from './interface/agent-admin.guard';
import { AgentChatController } from './interface/agent-chat.controller';
import { AgentLifecycleController } from './interface/agent-lifecycle.controller';
import { AgentSettingsController } from './interface/agent-settings.controller';
import { AgentRuntime } from './runtime/agent-runtime';
import { ContextBuilder } from './runtime/context-builder';
import { ToolAssembler } from './runtime/tool-assembler';
import { CredentialsToolkit } from './toolkits/credentials/credentials.toolkit';
import { DataReadToolkit } from './toolkits/data-read/data-read.toolkit';
import { MemoryToolkit } from './toolkits/memory/memory.toolkit';
import { SetupToolkit } from './toolkits/setup/setup.toolkit';
import { SkillsToolkit } from './toolkits/skills/skills.toolkit';
import { ThreadsToolkit } from './toolkits/threads/threads.toolkit';
import { ToolkitRegistry } from './toolkits/toolkit.registry';

/**
 * Composition root of the admin-only agent (design §5): binds the domain ports to their adapters.
 * Layers: interface → application → domain ← infrastructure.
 */
@Module({
  controllers: [AgentLifecycleController, AgentChatController, AgentSettingsController],
  imports: [
    EventJobModule.registerQueue(AGENT_JOBS_QUEUE),
    AiModule,
    SettingModule,
    SchemaPackModule,
    SpaceModule,
    BaseModule,
    FieldOpenApiModule,
    RecordModule,
    RecordOpenApiModule,
    ViewOpenApiModule,
    TrashModule,
    AiDataModule,
    AggregationOpenApiModule,
  ],
  providers: [
    AgentExecutionContext,
    AgentMembershipService,
    AgentSeeder,
    AgentExposureService,
    EnsureInstallation,
    AgentStatusQuery,
    ToolkitRegistry,
    MemoryToolkit,
    SkillsToolkit,
    ThreadsToolkit,
    SetupToolkit,
    CredentialsToolkit,
    DataReadToolkit,
    ToolAssembler,
    ContextBuilder,
    AgentRuntime,
    RunRegistry,
    TurnGate,
    AgentJobs,
    TurnJobs,
    AgentJobsProcessor,
    RunTurn,
    ResumeTurn,
    CancelRun,
    ManageThreads,
    ConfigureAgent,
    AgentAdminGuard,
    { provide: MODEL_PORT, useClass: ProviderModelAdapter },
    { provide: AUDIT_PORT, useClass: PrismaAuditLog },
    { provide: AGENT_LAYOUT_PORT, useExisting: EnsureInstallation },
    { provide: AGENT_STORE_PORT, useClass: AgentTableStore },
    { provide: RUN_STORE_PORT, useClass: PrismaRunStore },
    { provide: DATA_GATEWAY_PORT, useClass: UnrestrictedDataGateway },
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

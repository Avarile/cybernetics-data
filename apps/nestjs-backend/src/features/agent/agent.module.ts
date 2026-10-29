import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { AggregationOpenApiModule } from '../aggregation/open-api/aggregation-open-api.module';
import { AiModule } from '../ai/ai.module';
import { AiDataModule } from '../ai-data/ai-data.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { BaseModule } from '../base/base.module';
import { BaseSqlExecutorModule } from '../base-sql-executor/base-sql-executor.module';
import { ChatFileModule } from '../chat-file/chat-file.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SchemaPackModule } from '../schema-pack/schema-pack.module';
import { SettingModule } from '../setting/setting.module';
import { SpaceModule } from '../space/space.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { TrashModule } from '../trash/trash.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { ConfigureAgent } from './application/admin/configure-agent.usecase';
import { ManageCredentials } from './application/admin/manage-credentials.usecase';
import { CancelRun } from './application/chat/cancel-run.usecase';
import { ResumeTurn } from './application/chat/resume-turn.usecase';
import { RunTurn } from './application/chat/run-turn.usecase';
import { TurnGate } from './application/chat/turn-gate';
import { AgentSeeder } from './application/installation/agent-seeder';
import { EnsureInstallation } from './application/installation/ensure-installation.usecase';
import { AgentExposureService } from './application/installation/exposure';
import { AgentMembershipService } from './application/installation/membership';
import { AgentMembershipScheduler } from './application/installation/membership-scheduler';
import { AGENT_JOBS_QUEUE, AgentJobs } from './application/jobs/agent-jobs';
import { TurnJobs } from './application/jobs/turn-jobs';
import { KnowledgeIngest } from './application/knowledge/knowledge-ingest';
import { KnowledgeSearch } from './application/knowledge/knowledge-search';
import { KnowledgeSync } from './application/knowledge/knowledge-sync';
import { KnowledgeSyncScheduler } from './application/knowledge/knowledge-sync.scheduler';
import { RAG_JOBS_QUEUE } from './application/knowledge/rag-jobs';
import { GetSearch } from './application/search/get-search.query';
import { PlanSearch } from './application/search/plan-search.usecase';
import { RunSearch } from './application/search/run-search.usecase';
import { AgentStatusQuery } from './application/status/agent-status.query';
import { ManageThreads } from './application/threads/manage-threads.usecase';
import {
  AGENT_LAYOUT_PORT,
  AGENT_STORE_PORT,
  AUDIT_PORT,
  DATA_GATEWAY_PORT,
  HTTP_PORT,
  MODEL_PORT,
  RAG_SOURCE_READER_PORT,
  RAG_STORE_PORT,
  RUN_STORE_PORT,
  SCHEMA_CATALOG_PORT,
  SEARCH_LOG_PORT,
  SEARCH_READER_PORT,
  SECRET_VAULT_PORT,
} from './domain/ports';
import { PrismaAuditLog } from './infrastructure/audit/prisma-audit-log';
import { UnrestrictedDataGateway } from './infrastructure/data/unrestricted-data-gateway';
import { UnrestrictedDataWriter } from './infrastructure/data/unrestricted-data-writer';
import { AgentExecutionContext } from './infrastructure/execution-context';
import { OutboundHttp } from './infrastructure/http/outbound-http';
import { AgentJobsProcessor } from './infrastructure/jobs/agent-jobs.processor';
import { RagJobsProcessor } from './infrastructure/jobs/rag-jobs.processor';
import { KnowledgeSyncListener } from './infrastructure/knowledge/knowledge-sync.listener';
import { PgRagStore } from './infrastructure/knowledge/pg-rag-store';
import { SearchTables } from './infrastructure/knowledge/search-tables';
import { RagSourceReader } from './infrastructure/knowledge/source-reader';
import { ProviderModelAdapter } from './infrastructure/llm/provider-model.adapter';
import { PrismaRunStore } from './infrastructure/runs/prisma-run-store';
import { RunRegistry } from './infrastructure/runs/run-registry';
import { PrismaSearchLog } from './infrastructure/search/prisma-search-log';
import { SchemaCatalog } from './infrastructure/search/schema-catalog';
import { SearchReader } from './infrastructure/search/search-reader';
import { PrismaSecretVault } from './infrastructure/secrets/prisma-secret-vault';
import { AgentTableStore } from './infrastructure/store/agent-table-store';
import { AgentAdminGuard } from './interface/agent-admin.guard';
import { AgentChatController } from './interface/agent-chat.controller';
import { AgentLifecycleController } from './interface/agent-lifecycle.controller';
import { AgentSearchController } from './interface/agent-search.controller';
import { AgentSettingsController } from './interface/agent-settings.controller';
import { AgentRuntime } from './runtime/agent-runtime';
import { ContextBuilder } from './runtime/context-builder';
import { ToolAssembler } from './runtime/tool-assembler';
import { CredentialsToolkit } from './toolkits/credentials/credentials.toolkit';
import { DataReadToolkit } from './toolkits/data-read/data-read.toolkit';
import { DataWriteToolkit, SchemaToolkit } from './toolkits/data-write/data-write.toolkits';
import { HttpToolkit } from './toolkits/http/http.toolkit';
import { InvestigateToolkit } from './toolkits/investigate/investigate.toolkit';
import { KnowledgeToolkit } from './toolkits/knowledge/knowledge.toolkit';
import { MemoryToolkit } from './toolkits/memory/memory.toolkit';
import { SetupToolkit } from './toolkits/setup/setup.toolkit';
import { SkillsToolkit } from './toolkits/skills/skills.toolkit';
import { SqlReadToolkit } from './toolkits/sql-read/sql-read.toolkit';
import { ThreadsToolkit } from './toolkits/threads/threads.toolkit';
import { ToolkitRegistry } from './toolkits/toolkit.registry';

/**
 * Composition root of the admin-only agent (design §5): binds the domain ports to their adapters.
 * Layers: interface → application → domain ← infrastructure.
 */
@Module({
  controllers: [
    AgentLifecycleController,
    AgentChatController,
    AgentSettingsController,
    AgentSearchController,
  ],
  imports: [
    EventJobModule.registerQueue(AGENT_JOBS_QUEUE),
    EventJobModule.registerQueue(RAG_JOBS_QUEUE),
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
    TableOpenApiModule,
    AiDataModule,
    AggregationOpenApiModule,
    BaseSqlExecutorModule,
    ChatFileModule,
    StorageModule,
  ],
  providers: [
    AgentExecutionContext,
    AgentMembershipService,
    AgentMembershipScheduler,
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
    DataWriteToolkit,
    SchemaToolkit,
    SqlReadToolkit,
    HttpToolkit,
    KnowledgeToolkit,
    InvestigateToolkit,
    UnrestrictedDataWriter,
    ToolAssembler,
    ContextBuilder,
    AgentRuntime,
    RunRegistry,
    TurnGate,
    AgentJobs,
    TurnJobs,
    AgentJobsProcessor,
    KnowledgeIngest,
    KnowledgeSearch,
    RagJobsProcessor,
    KnowledgeSyncListener,
    SearchTables,
    KnowledgeSync,
    KnowledgeSyncScheduler,
    RunTurn,
    ResumeTurn,
    CancelRun,
    ManageThreads,
    GetSearch,
    PlanSearch,
    RunSearch,
    ConfigureAgent,
    ManageCredentials,
    AgentAdminGuard,
    { provide: MODEL_PORT, useClass: ProviderModelAdapter },
    { provide: AUDIT_PORT, useClass: PrismaAuditLog },
    { provide: AGENT_LAYOUT_PORT, useExisting: EnsureInstallation },
    { provide: AGENT_STORE_PORT, useClass: AgentTableStore },
    { provide: RUN_STORE_PORT, useClass: PrismaRunStore },
    { provide: SEARCH_LOG_PORT, useClass: PrismaSearchLog },
    { provide: SCHEMA_CATALOG_PORT, useClass: SchemaCatalog },
    { provide: SEARCH_READER_PORT, useClass: SearchReader },
    { provide: DATA_GATEWAY_PORT, useClass: UnrestrictedDataGateway },
    { provide: SECRET_VAULT_PORT, useClass: PrismaSecretVault },
    { provide: HTTP_PORT, useClass: OutboundHttp },
    { provide: RAG_STORE_PORT, useClass: PgRagStore },
    { provide: RAG_SOURCE_READER_PORT, useClass: RagSourceReader },
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

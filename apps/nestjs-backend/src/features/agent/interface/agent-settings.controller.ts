import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ISyncKnowledgeVo,
  IAgentAuditListVo,
  IAgentCredentialListVo,
  IAgentCredentialVo,
  IAgentSetupVo,
  ITestAgentCredentialVo,
} from '@teable/openapi';
import {
  agentAuditQuerySchema,
  IAgentAuditQuery,
  ISetAgentSecretRo,
  setAgentSecretRoSchema,
  ITestAgentCredentialRo,
  testAgentCredentialRoSchema,
  IUpdateAgentSetupRo,
  updateAgentSetupRoSchema,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { ConfigureAgent } from '../application/admin/configure-agent.usecase';
import { ManageCredentials } from '../application/admin/manage-credentials.usecase';
import { KnowledgeSync } from '../application/knowledge/knowledge-sync';
import { AgentExecutionContext } from '../infrastructure/execution-context';
import { AgentAdminGuard } from './agent-admin.guard';

/** Admin ▸ Agent: the default setup, credentials metadata, the audit log (design §12, §13). */
@Controller('api/agent')
@UseGuards(AgentAdminGuard)
export class AgentSettingsController {
  constructor(
    private readonly configure: ConfigureAgent,
    private readonly credentialsAdmin: ManageCredentials,
    private readonly sync: KnowledgeSync,
    private readonly execution: AgentExecutionContext,
    private readonly cls: ClsService<IClsStore>
  ) {}

  /** Index every searched table and agent memory now (as the agent); 409 while one runs. */
  @Post('admin/knowledge/sync')
  @HttpCode(200)
  async syncKnowledge(): Promise<ISyncKnowledgeVo> {
    const actorUserId = this.cls.get('user.id');
    return this.execution.run({ runId: 'admin:knowledge-sync', actorUserId }, () =>
      this.sync.syncAll()
    );
  }

  @Get('setup')
  async getSetup(): Promise<IAgentSetupVo> {
    return this.configure.getSetup();
  }

  @Patch('setup')
  async updateSetup(
    @Body(new ZodValidationPipe(updateAgentSetupRoSchema)) ro: IUpdateAgentSetupRo
  ): Promise<IAgentSetupVo> {
    return this.configure.updateSetup(this.cls.get('user.id'), ro);
  }

  @Get('credentials')
  async credentials(): Promise<IAgentCredentialListVo> {
    return this.configure.listCredentials();
  }

  @Put('credentials/:credentialId/secret')
  async setSecret(
    @Param('credentialId') credentialId: string,
    @Body(new ZodValidationPipe(setAgentSecretRoSchema)) ro: ISetAgentSecretRo
  ): Promise<IAgentCredentialVo> {
    return this.credentialsAdmin.setSecret(this.cls.get('user.id'), credentialId, ro);
  }

  @Delete('credentials/:credentialId/secret')
  async deleteSecret(@Param('credentialId') credentialId: string): Promise<IAgentCredentialVo> {
    return this.credentialsAdmin.deleteSecret(this.cls.get('user.id'), credentialId);
  }

  @Post('credentials/:credentialId/test')
  @HttpCode(200)
  async testCredential(
    @Param('credentialId') credentialId: string,
    @Body(new ZodValidationPipe(testAgentCredentialRoSchema)) ro: ITestAgentCredentialRo
  ): Promise<ITestAgentCredentialVo> {
    return this.credentialsAdmin.test(this.cls.get('user.id'), credentialId, ro.path);
  }

  @Get('audit')
  async audit(
    @Query(new ZodValidationPipe(agentAuditQuerySchema)) query: IAgentAuditQuery
  ): Promise<IAgentAuditListVo> {
    return this.configure.listAudit(query);
  }
}

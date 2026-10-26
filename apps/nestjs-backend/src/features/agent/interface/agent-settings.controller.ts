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
  IImportLegacyKnowledgeVo,
  IAgentAuditListVo,
  IAgentCredentialListVo,
  IAgentCredentialVo,
  IAgentSetupVo,
  ITestAgentCredentialVo,
} from '@teable/openapi';
import {
  importLegacyKnowledgeRoSchema,
  IImportLegacyKnowledgeRo,
  agentAuditQuerySchema,
  IAgentAuditQuery,
  ISetAgentSecretRo,
  setAgentSecretRoSchema,
  IUpdateAgentSetupRo,
  updateAgentSetupRoSchema,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { ConfigureAgent } from '../application/admin/configure-agent.usecase';
import { ManageCredentials } from '../application/admin/manage-credentials.usecase';
import { LegacyKnowledgeImport } from '../application/knowledge/legacy-import';
import { AgentAdminGuard } from './agent-admin.guard';

/** Admin ▸ Agent: the default setup, credentials metadata, the audit log (design §12, §13). */
@Controller('api/agent')
@UseGuards(AgentAdminGuard)
export class AgentSettingsController {
  constructor(
    private readonly configure: ConfigureAgent,
    private readonly credentialsAdmin: ManageCredentials,
    private readonly legacyImport: LegacyKnowledgeImport,
    private readonly cls: ClsService<IClsStore>
  ) {}

  /** One-off import of the old Mastra vectors (design §14.3). */
  @Post('admin/knowledge/import-legacy')
  @HttpCode(200)
  async importLegacyKnowledge(
    @Body(new ZodValidationPipe(importLegacyKnowledgeRoSchema)) ro: IImportLegacyKnowledgeRo
  ): Promise<IImportLegacyKnowledgeVo> {
    return this.legacyImport.run({
      dryRun: Boolean(ro.dryRun),
      actorUserId: this.cls.get('user.id'),
    });
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
    @Param('credentialId') credentialId: string
  ): Promise<ITestAgentCredentialVo> {
    return this.credentialsAdmin.test(this.cls.get('user.id'), credentialId);
  }

  @Get('audit')
  async audit(
    @Query(new ZodValidationPipe(agentAuditQuerySchema)) query: IAgentAuditQuery
  ): Promise<IAgentAuditListVo> {
    return this.configure.listAudit(query);
  }
}

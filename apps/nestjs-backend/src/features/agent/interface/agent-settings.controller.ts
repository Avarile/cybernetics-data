import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import type { IAgentAuditListVo, IAgentCredentialListVo, IAgentSetupVo } from '@teable/openapi';
import {
  agentAuditQuerySchema,
  IAgentAuditQuery,
  IUpdateAgentSetupRo,
  updateAgentSetupRoSchema,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { ConfigureAgent } from '../application/admin/configure-agent.usecase';
import { AgentAdminGuard } from './agent-admin.guard';

/** Admin ▸ Agent: the default setup, credentials metadata, the audit log (design §12, §13). */
@Controller('api/agent')
@UseGuards(AgentAdminGuard)
export class AgentSettingsController {
  constructor(
    private readonly configure: ConfigureAgent,
    private readonly cls: ClsService<IClsStore>
  ) {}

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

  @Get('audit')
  async audit(
    @Query(new ZodValidationPipe(agentAuditQuerySchema)) query: IAgentAuditQuery
  ): Promise<IAgentAuditListVo> {
    return this.configure.listAudit(query);
  }
}

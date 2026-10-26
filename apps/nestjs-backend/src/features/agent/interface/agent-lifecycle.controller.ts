import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { IAgentStatusVo } from '@teable/openapi';
import { IResetAgentRo, resetAgentRoSchema } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { EnsureInstallation } from '../application/installation/ensure-installation.usecase';
import { AgentStatusQuery } from '../application/status/agent-status.query';
import { AgentAdminGuard } from './agent-admin.guard';

/** Enable, check and reset the agent (design §7.1, §12). Signed-in instance admins only. */
@Controller('api/agent')
@UseGuards(AgentAdminGuard)
export class AgentLifecycleController {
  constructor(
    private readonly installation: EnsureInstallation,
    private readonly statusQuery: AgentStatusQuery,
    private readonly cls: ClsService<IClsStore>
  ) {}

  private get actor() {
    return this.cls.get('user.id');
  }

  @Get('status')
  async status(): Promise<IAgentStatusVo> {
    return this.statusQuery.get(this.actor);
  }

  @Post('admin/enable')
  @HttpCode(200)
  async enable(): Promise<IAgentStatusVo> {
    await this.installation.enable(this.actor);
    return this.statusQuery.get(this.actor);
  }

  @Post('admin/disable')
  @HttpCode(200)
  async disable(): Promise<IAgentStatusVo> {
    await this.installation.disable(this.actor);
    return this.statusQuery.get(this.actor);
  }

  @Post('admin/verify')
  @HttpCode(200)
  async verify(): Promise<IAgentStatusVo> {
    await this.installation.ensure('verify', this.actor);
    return this.statusQuery.get(this.actor);
  }

  @Post('admin/reset')
  @HttpCode(200)
  async reset(
    @Body(new ZodValidationPipe(resetAgentRoSchema)) _ro: IResetAgentRo
  ): Promise<IAgentStatusVo> {
    await this.installation.reset(this.actor);
    return this.statusQuery.get(this.actor);
  }
}

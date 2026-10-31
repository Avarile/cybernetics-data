import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { setDefaultBaseRoSchema } from '@teable/openapi';
import type {
  ICockpitBasesVo,
  ICockpitTablesVo,
  ISetDefaultBaseRo,
  ISetDefaultBaseVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { CockpitScope } from '../application/cockpit/cockpit-scope';
import { AgentAdminGuard } from './agent-admin.guard';

/** Scope design §10: the cockpit's bases and tables, its search and its record reader. */
@Controller('api/agent/cockpit')
@UseGuards(AgentAdminGuard)
export class AgentCockpitController {
  constructor(
    private readonly scope: CockpitScope,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Get('bases')
  async bases(): Promise<ICockpitBasesVo> {
    return this.scope.bases();
  }

  @Get('bases/:baseId/tables')
  async tables(@Param('baseId') baseId: string): Promise<ICockpitTablesVo> {
    return this.scope.tables(baseId);
  }

  @Put('default-base')
  async setDefaultBase(
    @Body(new ZodValidationPipe(setDefaultBaseRoSchema)) ro: ISetDefaultBaseRo
  ): Promise<ISetDefaultBaseVo> {
    return this.scope.setDefault(this.cls.get('user.id'), ro.baseId);
  }
}

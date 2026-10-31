import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { cockpitSearchQuerySchema, setDefaultBaseRoSchema } from '@teable/openapi';
import type {
  ICockpitBasesVo,
  ICockpitRecordVo,
  ICockpitSearchQuery,
  ICockpitSearchVo,
  ICockpitSummaryVo,
  ICockpitTablesVo,
  ISetDefaultBaseRo,
  ISetDefaultBaseVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { CockpitRecords } from '../application/cockpit/cockpit-records';
import { CockpitScope } from '../application/cockpit/cockpit-scope';
import { AgentAdminGuard } from './agent-admin.guard';

/** Scope design §10: the cockpit's bases and tables, its search and its record reader. */
@Controller('api/agent/cockpit')
@UseGuards(AgentAdminGuard)
export class AgentCockpitController {
  constructor(
    private readonly scope: CockpitScope,
    private readonly records: CockpitRecords,
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

  @Get('tables/:tableId/search')
  async search(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(cockpitSearchQuerySchema)) query: ICockpitSearchQuery
  ): Promise<ICockpitSearchVo> {
    return this.records.search(tableId, query.q, query.take);
  }

  @Get('tables/:tableId/records/:recordId')
  async record(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string
  ): Promise<ICockpitRecordVo> {
    return this.records.read(tableId, recordId);
  }

  @Post('tables/:tableId/records/:recordId/summary')
  @HttpCode(HttpStatus.OK)
  async summary(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string
  ): Promise<ICockpitSummaryVo> {
    return this.records.summarize(this.cls.get('user.id'), tableId, recordId);
  }
}

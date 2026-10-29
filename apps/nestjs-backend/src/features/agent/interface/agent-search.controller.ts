import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { IAgentSearchListVo, IAgentSearchVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { GetSearch } from '../application/search/get-search.query';
import { AgentAdminGuard } from './agent-admin.guard';

/** Cockpit design §11: stored searches, for the board of a reopened thread. */
@Controller('api/agent')
@UseGuards(AgentAdminGuard)
export class AgentSearchController {
  constructor(
    private readonly searches: GetSearch,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Get('searches/:searchId')
  async get(@Param('searchId') searchId: string): Promise<IAgentSearchVo> {
    return this.searches.get(this.cls.get('user.id'), searchId);
  }

  @Get('threads/:threadId/searches')
  async list(@Param('threadId') threadId: string): Promise<IAgentSearchListVo> {
    return this.searches.list(this.cls.get('user.id'), threadId);
  }
}

import { createHash } from 'crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { overviewDatasetSchema, overviewNodesRoSchema } from '@teable/openapi';
import type {
  IAgentOverviewVo,
  IAgentTableOverviewVo,
  IOverviewDatasetId,
  IOverviewNodesRo,
  IOverviewNodesVo,
} from '@teable/openapi';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { GetOverview } from '../application/overview/get-overview.query';
import { GetTableOverview } from '../application/overview/get-table-overview.query';
import { AgentAdminGuard } from './agent-admin.guard';

/** Same content, same tag: builtAt is left out, so a rebuilt but unchanged overview is a 304. */
const etagOf = ({ builtAt: _builtAt, ...content }: IAgentOverviewVo | IAgentTableOverviewVo) =>
  `"${createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 16)}"`;

/** The ETag, the private cache headers, and a 304 when the client has this content. */
function conditional<T extends IAgentOverviewVo | IAgentTableOverviewVo>(
  vo: T,
  req: Request,
  res: Response
): T | undefined {
  const etag = etagOf(vo);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Cookie, Authorization');
  if (req.headers['if-none-match'] === etag) {
    res.status(HttpStatus.NOT_MODIFIED);
    return undefined;
  }
  return vo;
}

/**
 * Overview design §8.3 and scope design §9: a dataset of the data base, or one table of any
 * base, for the cockpit's stage.
 */
@Controller('api/agent')
@UseGuards(AgentAdminGuard)
export class AgentOverviewController {
  constructor(
    private readonly overview: GetOverview,
    private readonly tableOverview: GetTableOverview,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Get('overview/:dataset')
  async get(
    @Param('dataset', new ZodValidationPipe(overviewDatasetSchema)) dataset: IOverviewDatasetId,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<IAgentOverviewVo | undefined> {
    return conditional(await this.overview.get(this.cls.get('user.id'), dataset), req, res);
  }

  @Get('overview/tables/:tableId')
  async table(
    @Param('tableId') tableId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<IAgentTableOverviewVo | undefined> {
    return conditional(await this.tableOverview.get(this.cls.get('user.id'), tableId), req, res);
  }

  @Post('overview/tables/:tableId/nodes')
  @HttpCode(HttpStatus.OK)
  async nodes(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(overviewNodesRoSchema)) ro: IOverviewNodesRo
  ): Promise<IOverviewNodesVo> {
    return this.tableOverview.nodes(tableId, ro.recordIds);
  }
}

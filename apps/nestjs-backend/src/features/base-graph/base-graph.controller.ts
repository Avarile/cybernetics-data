/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type {
  IBaseGraphExpandVo,
  IBaseGraphNodeVo,
  IBaseGraphSchemaVo,
  IBaseGraphVo,
} from '@teable/openapi';
import {
  baseGraphExpandRoSchema,
  baseGraphQueryRoSchema,
  getBaseGraphNodeQuerySchema,
  IBaseGraphExpandRo,
  IBaseGraphQueryRo,
  IGetBaseGraphNodeQuery,
} from '@teable/openapi';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BaseGraphService } from './base-graph.service';
import { GraphNodeService } from './graph-node.service';

/**
 * Mounted under `api/base/:baseId` because PermissionGuard resolves the
 * resource from `req.params.baseId`; @Permissions is mandatory, or API tokens
 * are blocked. AuthGuard and PermissionGuard are global APP_GUARDs.
 *
 * `record|read` on the base is the whole check at the route: every table,
 * field and view id in a request is then verified to belong to this base.
 */
@Controller('api/base/:baseId/graph')
export class BaseGraphController {
  constructor(
    private readonly baseGraphService: BaseGraphService,
    private readonly graphNodeService: GraphNodeService
  ) {}

  @Permissions('record|read')
  @Get('schema')
  async getSchema(@Param('baseId') baseId: string): Promise<IBaseGraphSchemaVo> {
    return this.baseGraphService.getSchema(baseId);
  }

  /**
   * POST because a per-table IFilter is a nested tree. 200, not 201: nothing is
   * created. The ETag is computed before the read, so a matching
   * If-None-Match costs one aggregate per table.
   */
  @Permissions('record|read')
  @Post('query')
  @HttpCode(HttpStatus.OK)
  async query(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(baseGraphQueryRoSchema)) ro: IBaseGraphQueryRo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<IBaseGraphVo | undefined> {
    const result = await this.baseGraphService.query(baseId, ro, req.headers['if-none-match']);

    res.setHeader('ETag', result.etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Vary', 'Cookie, Authorization');

    if (result.notModified) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return result.vo;
  }

  @Permissions('record|read')
  @Get('node/:recordId')
  async getNode(
    @Param('baseId') baseId: string,
    @Param('recordId') recordId: string,
    @Query(new ZodValidationPipe(getBaseGraphNodeQuerySchema)) query: IGetBaseGraphNodeQuery
  ): Promise<IBaseGraphNodeVo> {
    return this.graphNodeService.getNode(baseId, recordId, query);
  }

  @Permissions('record|read')
  @Post('expand')
  @HttpCode(HttpStatus.OK)
  async expand(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(baseGraphExpandRoSchema)) ro: IBaseGraphExpandRo
  ): Promise<IBaseGraphExpandVo> {
    return this.graphNodeService.expand(baseId, ro);
  }
}

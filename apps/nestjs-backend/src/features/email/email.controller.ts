import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { ICreateEmailTableVo, IEmailFolder, IEmailSourceVo } from '@teable/openapi';
import {
  createEmailTableRoSchema,
  ICreateEmailTableRo,
  IUpdateEmailSourceRo,
  updateEmailSourceRoSchema,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { EmailSourceService } from './email-source.service';

@Controller('api/base/:baseId/email')
export class EmailController {
  constructor(private readonly emailSourceService: EmailSourceService) {}

  @Post('tables')
  @Permissions('table|create')
  async createTable(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createEmailTableRoSchema)) body: ICreateEmailTableRo
  ): Promise<ICreateEmailTableVo> {
    return await this.emailSourceService.createEmailTable(baseId, body);
  }

  @Get('sources')
  @Permissions('base|read')
  async listSources(@Param('baseId') baseId: string): Promise<IEmailSourceVo[]> {
    return await this.emailSourceService.listSources(baseId);
  }

  @Patch('sources/:sourceId')
  @Permissions('table|update')
  async updateSource(
    @Param('baseId') baseId: string,
    @Param('sourceId') sourceId: string,
    @Body(new ZodValidationPipe(updateEmailSourceRoSchema)) body: IUpdateEmailSourceRo
  ): Promise<IEmailSourceVo> {
    return await this.emailSourceService.updateSource(baseId, sourceId, body);
  }

  @Post('sources/:sourceId/sync')
  @HttpCode(202)
  @Permissions('table|update')
  async syncNow(@Param('baseId') baseId: string, @Param('sourceId') sourceId: string) {
    await this.emailSourceService.syncNow(baseId, sourceId);
  }
}

@Controller('api/user-integrations')
export class EmailFolderController {
  constructor(private readonly emailSourceService: EmailSourceService) {}

  @Get(':integrationId/folders')
  @Permissions('user|integrations')
  async listFolders(@Param('integrationId') integrationId: string): Promise<IEmailFolder[]> {
    return await this.emailSourceService.listFolders(integrationId);
  }
}

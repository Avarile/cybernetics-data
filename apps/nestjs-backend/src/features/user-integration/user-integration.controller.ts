/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type {
  ICreateImapIntegrationVo,
  ITestConnectionVo,
  IUserIntegrationListVo,
  IUserIntegrationTokenVo,
} from '@teable/openapi';
import {
  createImapIntegrationRoSchema,
  getUserIntegrationListRoSchema,
  ICreateImapIntegrationRo,
  ITestConnectionRo,
  IUpdateUserIntegrationNameRo,
  IUserIntegrationListRo,
  testConnectionRoSchema,
  updateUserIntegrationNameSchema,
} from '@teable/openapi';
import { Response } from 'express';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { renderOAuthCallbackPage } from './oauth-callback.page';
import { UserIntegrationService } from './user-integration.service';

@Controller('api/user-integrations')
export class UserIntegrationController {
  constructor(
    private readonly userIntegrationService: UserIntegrationService,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

  @Get()
  @Permissions('user|integrations')
  async list(
    @Query(new ZodValidationPipe(getUserIntegrationListRoSchema)) query: IUserIntegrationListRo
  ): Promise<IUserIntegrationListVo> {
    return await this.userIntegrationService.list(query.provider);
  }

  @Put(':integrationId/name')
  @Permissions('user|integrations')
  async rename(
    @Param('integrationId') integrationId: string,
    @Body(new ZodValidationPipe(updateUserIntegrationNameSchema)) body: IUpdateUserIntegrationNameRo
  ): Promise<void> {
    await this.userIntegrationService.rename(integrationId, body.name);
  }

  @Delete(':integrationId')
  @Permissions('user|integrations')
  async delete(@Param('integrationId') integrationId: string): Promise<void> {
    await this.userIntegrationService.delete(integrationId);
  }

  @Post(':integrationId/token')
  @HttpCode(200)
  @Permissions('user|integrations')
  async getToken(@Param('integrationId') integrationId: string): Promise<IUserIntegrationTokenVo> {
    return await this.userIntegrationService.getAccessToken(integrationId);
  }

  @Get('authorize/:provider')
  @Permissions('user|integrations')
  async authorize(
    @Param('provider') provider: string,
    @Query('name') name: string | undefined,
    @Res() res: Response
  ) {
    res.redirect(await this.userIntegrationService.startAuthorize(provider, name));
  }

  @Get('callback/:provider')
  @Permissions('user|integrations')
  async callback(
    @Param('provider') provider: string,
    @Query() query: { code?: string; state?: string; error?: string },
    @Res() res: Response
  ) {
    const result = await this.userIntegrationService.completeAuthorize(provider, {
      code: typeof query.code === 'string' ? query.code : undefined,
      state: typeof query.state === 'string' ? query.state : undefined,
      error: typeof query.error === 'string' ? query.error : undefined,
    });
    const { html, csp } = renderOAuthCallbackPage(result, this.baseConfig.publicOrigin ?? '');
    res
      .status(200)
      .setHeader('Content-Security-Policy', csp)
      .setHeader('Cache-Control', 'no-store')
      .type('html')
      .send(html);
  }

  @Post('imap')
  @Permissions('user|integrations')
  async createImap(
    @Body(new ZodValidationPipe(createImapIntegrationRoSchema)) body: ICreateImapIntegrationRo
  ): Promise<ICreateImapIntegrationVo> {
    return await this.userIntegrationService.createImap(body);
  }

  @Post('test-connection')
  @HttpCode(200)
  @Permissions('user|integrations')
  async testConnection(
    @Body(new ZodValidationPipe(testConnectionRoSchema)) body: ITestConnectionRo
  ): Promise<ITestConnectionVo> {
    return await this.userIntegrationService.testConnection(body);
  }
}

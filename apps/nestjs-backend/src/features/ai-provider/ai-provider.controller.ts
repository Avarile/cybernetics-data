import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  IAiEnvStatusVo,
  IAiProviderListVo,
  IAiProviderModelsVo,
  IAiProviderVo,
  ITestAiProviderModelsVo,
  ITestAiProviderVo,
} from '@teable/openapi';
import {
  createAiProviderRoSchema,
  ICreateAiProviderRo,
  ITestAiProviderModelsRo,
  ITestAiProviderRo,
  IUpdateAiProviderRo,
  testAiProviderModelsRoSchema,
  testAiProviderRoSchema,
  updateAiProviderRoSchema,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AiProviderTestService } from './ai-provider-test.service';
import { AiProviderService } from './ai-provider.service';

const instanceRead = 'instance|read' as const;
const instanceUpdate = 'instance|update' as const;

/** Instance LLM providers. Instance admins only; keys never appear in a response. */
@Controller('api/admin/ai')
export class AiProviderController {
  constructor(
    private readonly providers: AiProviderService,
    private readonly tests: AiProviderTestService
  ) {}

  @Get('providers')
  @Permissions(instanceRead)
  async list(): Promise<IAiProviderListVo> {
    return this.providers.list();
  }

  @Post('providers')
  @Permissions(instanceUpdate)
  async create(
    @Body(new ZodValidationPipe(createAiProviderRoSchema)) ro: ICreateAiProviderRo
  ): Promise<IAiProviderVo> {
    return this.providers.create(ro);
  }

  // Declared before the :providerId routes so "test" is not read as an id.
  @Post('providers/test')
  @Permissions(instanceUpdate)
  async test(
    @Body(new ZodValidationPipe(testAiProviderRoSchema)) ro: ITestAiProviderRo
  ): Promise<ITestAiProviderVo> {
    return this.tests.test(ro);
  }

  @Patch('providers/:providerId')
  @Permissions(instanceUpdate)
  async update(
    @Param('providerId') providerId: string,
    @Body(new ZodValidationPipe(updateAiProviderRoSchema)) ro: IUpdateAiProviderRo
  ): Promise<IAiProviderVo> {
    return this.providers.update(providerId, ro);
  }

  @Delete('providers/:providerId')
  @Permissions(instanceUpdate)
  async delete(@Param('providerId') providerId: string): Promise<void> {
    await this.providers.delete(providerId);
  }

  @Get('providers/:providerId/models')
  @Permissions(instanceRead)
  async models(@Param('providerId') providerId: string): Promise<IAiProviderModelsVo> {
    return this.tests.models(providerId);
  }

  @Post('providers/:providerId/models/test')
  @Permissions(instanceUpdate)
  async testModels(
    @Param('providerId') providerId: string,
    @Body(new ZodValidationPipe(testAiProviderModelsRoSchema)) ro: ITestAiProviderModelsRo
  ): Promise<ITestAiProviderModelsVo> {
    return this.tests.testModels(providerId, ro.models);
  }

  @Get('env-status')
  @Permissions(instanceRead)
  async envStatus(@Query('name') name: string): Promise<IAiEnvStatusVo> {
    return this.providers.envStatus(String(name ?? ''));
  }
}

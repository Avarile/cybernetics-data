import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type {
  ISchemaPackCatalogVo,
  ISchemaPackInstallVo,
  ISchemaPackPlanVo,
} from '@teable/openapi';
import {
  ISchemaPackInstallRo,
  ISchemaPackPlanRo,
  schemaPackInstallRoSchema,
  schemaPackPlanRoSchema,
} from '@teable/openapi';
import { EmitControllerEvent } from '../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../event-emitter/events';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { getSchemaPackCatalog, toCatalogVo } from './schema-pack.catalog';
import { SchemaPackInstallerService } from './schema-pack.installer';

/**
 * The catalog and the plan read no user data (a plan into an existing base checks
 * `base|read` itself), so they need only a signed-in user. Install creates a base, so it
 * takes the same `base|create` on the space as base creation and template apply.
 */
@Controller('api/schema-pack')
export class SchemaPackController {
  constructor(private readonly installer: SchemaPackInstallerService) {}

  @Get()
  async getCatalog(): Promise<ISchemaPackCatalogVo> {
    return toCatalogVo(getSchemaPackCatalog());
  }

  @Post('plan')
  @HttpCode(HttpStatus.OK)
  async plan(
    @Body(new ZodValidationPipe(schemaPackPlanRoSchema)) ro: ISchemaPackPlanRo
  ): Promise<ISchemaPackPlanVo> {
    return await this.installer.plan(ro);
  }

  @Post('install')
  @Permissions('base|create')
  @ResourceMeta('spaceId', 'body')
  @EmitControllerEvent(Events.BASE_CREATE)
  async install(
    @Body(new ZodValidationPipe(schemaPackInstallRoSchema)) ro: ISchemaPackInstallRo
  ): Promise<ISchemaPackInstallVo> {
    return await this.installer.install(ro);
  }
}

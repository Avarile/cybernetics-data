import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type {
  ISchemaPackCatalogVo,
  ISchemaPackInstallVo,
  ISchemaPackPlanVo,
} from '@teable/openapi';
import {
  ISchemaPackAddRo,
  ISchemaPackInstallRo,
  ISchemaPackPlanRo,
  schemaPackAddRoSchema,
  schemaPackInstallRoSchema,
  schemaPackPlanRoSchema,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { getSchemaPackCatalog, toCatalogVo } from './schema-pack.catalog';
import { SchemaPackInstallerService } from './schema-pack.installer';

/**
 * Packs into a new base. The catalog and a new-base plan read no user data, so they need only a
 * signed-in user. Install creates a base, so it takes the same `base|create` on the space as base
 * creation and template apply; the installer emits `base.create` itself.
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
  async install(
    @Body(new ZodValidationPipe(schemaPackInstallRoSchema)) ro: ISchemaPackInstallRo
  ): Promise<ISchemaPackInstallVo> {
    return await this.installer.install(ro);
  }
}

/**
 * Packs into an existing base. Permissions are checked on the base itself, so a collaborator
 * invited to just this base can add packs without any role in its space.
 */
@Controller('api/base/:baseId/schema-pack')
export class SchemaPackBaseController {
  constructor(private readonly installer: SchemaPackInstallerService) {}

  @Post('plan')
  @HttpCode(HttpStatus.OK)
  @Permissions('base|read')
  async plan(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(schemaPackPlanRoSchema)) ro: ISchemaPackPlanRo
  ): Promise<ISchemaPackPlanVo> {
    return await this.installer.plan(ro, baseId);
  }

  @Post('install')
  @Permissions('table|create', 'field|create', 'record|create')
  async install(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(schemaPackAddRoSchema)) ro: ISchemaPackAddRo
  ): Promise<ISchemaPackInstallVo> {
    return await this.installer.addToBase(baseId, ro);
  }
}

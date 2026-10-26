import { Module } from '@nestjs/common';
import { BaseModule } from '../base/base.module';
import { FieldModule } from '../field/field.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { UserModule } from '../user/user.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { SchemaPackBaseController, SchemaPackController } from './schema-pack.controller';
import { SchemaPackInstallerService } from './schema-pack.installer';

/** Access checks run in the global PermissionGuard; EventEmitterService is global too. */
@Module({
  imports: [
    BaseModule,
    FieldModule,
    FieldOpenApiModule,
    RecordOpenApiModule,
    TableOpenApiModule,
    UserModule,
    ViewOpenApiModule,
  ],
  controllers: [SchemaPackController, SchemaPackBaseController],
  providers: [SchemaPackInstallerService],
  exports: [SchemaPackInstallerService],
})
export class SchemaPackModule {}

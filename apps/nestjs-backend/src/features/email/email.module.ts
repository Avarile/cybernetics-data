import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { NotificationModule } from '../notification/notification.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { UserIntegrationModule } from '../user-integration/user-integration.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { EmailSourceService } from './email-source.service';
import { EmailController, EmailFolderController } from './email.controller';
import { EMAIL_SYNC_QUEUE, EmailSyncQueueProcessor } from './sync/email-sync.processor';
import { EmailSyncScheduler } from './sync/email-sync.scheduler';
import { EmailSyncService } from './sync/email-sync.service';

/** Email tables. Access checks run in the global PermissionGuard. */
@Module({
  imports: [
    EventJobModule.registerQueue(EMAIL_SYNC_QUEUE),
    AttachmentsModule,
    NotificationModule,
    RecordOpenApiModule,
    TableOpenApiModule,
    UserIntegrationModule,
    ViewOpenApiModule,
  ],
  controllers: [EmailController, EmailFolderController],
  providers: [EmailSourceService, EmailSyncService, EmailSyncQueueProcessor, EmailSyncScheduler],
})
export class EmailModule {}

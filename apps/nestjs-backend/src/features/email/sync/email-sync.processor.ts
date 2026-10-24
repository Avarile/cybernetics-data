import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { EmailSyncService } from './email-sync.service';

export const EMAIL_SYNC_QUEUE = 'email-sync-queue';

interface IEmailSyncJob {
  sourceId: string;
}

@Injectable()
@Processor(EMAIL_SYNC_QUEUE, { concurrency: 2 })
export class EmailSyncQueueProcessor extends WorkerHost {
  constructor(
    private readonly emailSyncService: EmailSyncService,
    @InjectQueue(EMAIL_SYNC_QUEUE) public readonly queue: Queue<IEmailSyncJob>
  ) {
    super();
  }

  /**
   * No job id: a duplicate request is cheap, because runs for one mailbox take a lock and a run
   * that finds it taken returns at once. A job id would also match finished jobs and drop the request.
   */
  async enqueue(sourceId: string) {
    await this.queue.add(
      'sync',
      { sourceId },
      { removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } }
    );
  }

  async process(job: Job<IEmailSyncJob>) {
    if (await this.emailSyncService.run(job.data.sourceId)) {
      await this.enqueue(job.data.sourceId);
    }
  }
}

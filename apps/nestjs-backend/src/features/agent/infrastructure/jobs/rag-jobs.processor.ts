import { Processor, WorkerHost } from '@nestjs/bullmq';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { KnowledgeIngest } from '../../application/knowledge/knowledge-ingest';
import { KnowledgeSync } from '../../application/knowledge/knowledge-sync';
import {
  RAG_JOBS_QUEUE,
  type IRagJobData,
  type IRagJobName,
} from '../../application/knowledge/rag-jobs';
import { AgentExecutionContext } from '../execution-context';

/** Runs knowledge jobs (design §11.3) as the agent, so every base can be read. */
@Injectable()
@Processor(RAG_JOBS_QUEUE, {
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
})
export class RagJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(RagJobsProcessor.name);

  constructor(
    private readonly ingest: KnowledgeIngest,
    private readonly sync: KnowledgeSync,
    private readonly execution: AgentExecutionContext
  ) {
    super();
  }

  async process(job: Job<IRagJobData>) {
    const name = job.name as IRagJobName;
    const scope = { runId: `rag:${job.id ?? name}`, actorUserId: job.data.actorUserId };
    try {
      return await this.execution.run(scope, async (): Promise<unknown> => {
        switch (name) {
          case 'ingest':
            return this.ingest.ingest(job.data);
          case 'remove':
            return job.data.documentId ? this.ingest.remove(job.data.documentId) : undefined;
          case 'ingest-records': {
            const { collectionId, baseId, tableId, recordIds } = job.data;
            if (!collectionId || !baseId || !tableId || !recordIds) return undefined;
            const summary = await this.sync.indexRecords(collectionId, baseId, tableId, recordIds);
            // a record that failed is tried again with the job
            if (summary.failed) throw new Error(summary.errors.join(' | '));
            return summary;
          }
          case 'sync':
            // another full sync is running (another replica, an admin): this one is not needed
            return this.sync.syncAll().catch((error) => {
              if (error instanceof HttpException && error.getStatus() === HttpStatus.CONFLICT) {
                return undefined;
              }
              throw error;
            });
          case 'sync-table':
            return job.data.tableId ? this.sync.syncTable(job.data.tableId) : undefined;
          case 'remove-table':
            return job.data.tableId ? this.sync.removeTable(job.data.tableId) : undefined;
          default:
            this.logger.warn(`unknown knowledge job ${String(name)}`);
            return undefined;
        }
      });
    } catch (error) {
      this.logger.error(`knowledge job ${name} (${job.id}) failed: ${(error as Error).message}`);
      throw error;
    }
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AGENT_JOBS_QUEUE, type IAgentJobName } from '../../application/jobs/agent-jobs';
import { TurnJobs, type ITurnJobData } from '../../application/jobs/turn-jobs';
import { AgentExecutionContext } from '../execution-context';

/** Runs agent jobs (BullMQ with Redis, the in-process fallback queue without). */
@Injectable()
@Processor(AGENT_JOBS_QUEUE, {
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
})
export class AgentJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentJobsProcessor.name);

  constructor(
    private readonly jobs: TurnJobs,
    private readonly execution: AgentExecutionContext
  ) {
    super();
  }

  async process(job: Job<ITurnJobData>) {
    const name = job.name as IAgentJobName;
    const scope = { runId: job.data.runId, actorUserId: job.data.actorUserId };
    try {
      return await this.execution.run(scope, async (): Promise<unknown> => {
        switch (name) {
          case 'title':
            return this.jobs.title(job.data);
          case 'summary':
            return this.jobs.summary(job.data);
          case 'memory-extract':
            return this.jobs.extractMemories(job.data);
          case 'usage':
            return this.jobs.usage(job.data);
          default:
            this.logger.warn(`unknown agent job ${String(name)}`);
            return undefined;
        }
      });
    } catch (error) {
      this.logger.error(
        `agent job ${name} for run ${job.data.runId} failed: ${(error as Error).message}`
      );
      throw error;
    }
  }
}

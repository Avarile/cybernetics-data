import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { IMemoryMode } from '../../domain/entities';
import type { IRunStatus } from '../../domain/ports';
import type { ITurnJobData } from './turn-jobs';

export const AGENT_JOBS_QUEUE = 'agent-jobs';
export type IAgentJobName = 'title' | 'summary' | 'memory-extract' | 'usage';

export interface ITurnOutcome {
  status: IRunStatus;
  droppedMessages: number;
  firstTurn: boolean;
  memoryMode: IMemoryMode | null;
}

/** Which jobs a finished turn needs (pure, so the rules are easy to test). */
export function jobsFor(outcome: ITurnOutcome): IAgentJobName[] {
  const jobs: IAgentJobName[] = ['usage'];
  const answered = outcome.status === 'done' || outcome.status === 'awaiting_approval';
  if (answered && outcome.firstTurn) jobs.push('title');
  if (outcome.droppedMessages > 0) jobs.push('summary');
  if (outcome.status === 'done' && outcome.memoryMode === 'auto') jobs.push('memory-extract');
  return jobs;
}

/** Enqueues the background work of a turn (design §10.1 step 7). Never fails the turn. */
@Injectable()
export class AgentJobs {
  private readonly logger = new Logger(AgentJobs.name);

  constructor(@InjectQueue(AGENT_JOBS_QUEUE) private readonly queue: Queue<ITurnJobData>) {}

  async afterTurn(data: ITurnJobData, outcome: ITurnOutcome) {
    for (const name of jobsFor(outcome)) {
      try {
        await this.queue.add(
          name,
          { ...data, droppedMessages: outcome.droppedMessages },
          // a job can race the next turn on the same thread record; try again shortly
          { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
        );
      } catch (error) {
        this.logger.warn(`agent job ${name} not queued: ${(error as Error).message}`);
      }
    }
  }
}

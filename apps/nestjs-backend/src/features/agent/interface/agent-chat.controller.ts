import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type {
  IAgentMessageListVo,
  IAgentRunVo,
  IAgentThreadListVo,
  IAgentThreadVo,
} from '@teable/openapi';
import {
  agentChatRoSchema,
  agentThreadListQuerySchema,
  IAgentChatRo,
  IAgentThreadListQuery,
  IUpdateAgentThreadRo,
  updateAgentThreadRoSchema,
} from '@teable/openapi';
import { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { CancelRun } from '../application/chat/cancel-run.usecase';
import { ResumeTurn } from '../application/chat/resume-turn.usecase';
import { RunTurn } from '../application/chat/run-turn.usecase';
import { ManageThreads } from '../application/threads/manage-threads.usecase';
import { AgentAdminGuard } from './agent-admin.guard';
import { pumpUIMessageStream } from './ui-stream-pump';

const threadHeader = 'x-agent-thread-id';
const runHeader = 'x-agent-run-id';
const threadIdParam = 'threadId';
const threadPath = 'threads/:threadId';

/** Chat, cancel and the caller's threads (design §12). Signed-in instance admins only. */
@Controller('api/agent')
@UseGuards(AgentAdminGuard)
export class AgentChatController {
  private readonly logger = new Logger(AgentChatController.name);

  constructor(
    private readonly runTurn: RunTurn,
    private readonly resumeTurn: ResumeTurn,
    private readonly cancelRun: CancelRun,
    private readonly threads: ManageThreads,
    private readonly cls: ClsService<IClsStore>
  ) {}

  private get actor() {
    return this.cls.get('user.id');
  }

  /** Errors before the first byte are normal JSON errors; after that they are stream parts. */
  @Post('chat')
  async chat(
    @Body(new ZodValidationPipe(agentChatRoSchema)) ro: IAgentChatRo,
    @Res() res: Response
  ): Promise<void> {
    const turn = ro.approvals
      ? await this.resumeTurn.execute(this.actor, ro)
      : await this.runTurn.execute(this.actor, ro);
    res.on('close', () => {
      if (!res.writableFinished) turn.abort();
    });
    await pumpUIMessageStream(res, turn.stream, {
      [threadHeader]: turn.threadId,
      [runHeader]: turn.runId,
    }).catch((error) =>
      this.logger.error(`agent stream ${turn.runId} broke: ${(error as Error).message}`)
    );
  }

  @Post('runs/:runId/cancel')
  async cancel(@Param('runId') runId: string): Promise<IAgentRunVo> {
    return this.cancelRun.execute(this.actor, runId);
  }

  @Get('threads')
  async listThreads(
    @Query(new ZodValidationPipe(agentThreadListQuerySchema)) query: IAgentThreadListQuery
  ): Promise<IAgentThreadListVo> {
    return this.threads.list(this.actor, query);
  }

  @Get(threadPath)
  async getThread(@Param(threadIdParam) threadId: string): Promise<IAgentThreadVo> {
    return this.threads.get(this.actor, threadId);
  }

  @Patch(threadPath)
  async updateThread(
    @Param(threadIdParam) threadId: string,
    @Body(new ZodValidationPipe(updateAgentThreadRoSchema)) ro: IUpdateAgentThreadRo
  ): Promise<IAgentThreadVo> {
    return this.threads.update(this.actor, threadId, ro);
  }

  @Delete(threadPath)
  async deleteThread(@Param(threadIdParam) threadId: string): Promise<void> {
    await this.threads.delete(this.actor, threadId);
  }

  @Get('threads/:threadId/messages')
  async messages(@Param(threadIdParam) threadId: string): Promise<IAgentMessageListVo> {
    return this.threads.messages(this.actor, threadId);
  }
}

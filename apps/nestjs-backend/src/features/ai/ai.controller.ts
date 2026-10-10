import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { aiGenerateRoSchema, IAiGenerateRo } from '@teable/openapi';
import { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TablePipe } from '../table/open-api/table.pipe';
import { AiService } from './ai.service';

@Controller('api/:baseId/ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Post('/generate-stream')
  @Permissions('base|read')
  async generateStream(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(aiGenerateRoSchema), TablePipe) aiGenerateRo: IAiGenerateRo,
    @Res() res: Response
  ) {
    await this.aiService.generateStream(baseId, aiGenerateRo, res);
  }

  @Get('/config')
  @Permissions('base|read')
  async getAIConfig(@Param('baseId') baseId: string) {
    return await this.aiService.getSimplifiedAIConfig(baseId);
  }

  @Get('/disable-ai-actions')
  @Permissions('base|read')
  async getAIDisableAIActions(@Param('baseId') baseId: string) {
    return await this.aiService.getAIDisableAIActions(baseId);
  }

  // ── Mastra thread management ─────────────────────────────────────────────

  @Post('/threads')
  @Permissions('base|read')
  async createThread(
    @Param('baseId') _baseId: string,
    @Body() body: { agentId: string; title?: string }
  ) {
    const userId = this.cls.get('user').id;
    return this.aiService.createThread(userId, body.agentId, body?.title);
  }

  @Get('/threads')
  @Permissions('base|read')
  async listThreads(@Param('baseId') _baseId: string) {
    const userId = this.cls.get('user').id;
    return this.aiService.listThreads(userId);
  }

  @Get('/threads/:threadId')
  @Permissions('base|read')
  async getThread(
    @Param('baseId') _baseId: string,
    @Param('threadId') threadId: string,
    @Query('agentId') agentId: string
  ) {
    const userId = this.cls.get('user').id;
    const thread = await this.aiService.getThread(threadId, agentId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);
    // H2 — a thread is only visible to the user that owns it.
    if (thread.resourceId !== userId) throw new ForbiddenException('Thread access denied');
    return thread;
  }

  @Get('/threads/:threadId/messages')
  @Permissions('base|read')
  async getThreadMessages(
    @Param('baseId') _baseId: string,
    @Param('threadId') threadId: string,
    @Query('agentId') agentId: string
  ) {
    if (!agentId) throw new BadRequestException('agentId is required');
    const userId = this.cls.get('user').id;
    // agentId is required so Mastra can resolve the agent's memory.
    const thread = await this.aiService.getThread(threadId, agentId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);
    // H2 — only the owning user may read a thread's messages.
    if (thread.resourceId !== userId) throw new ForbiddenException('Thread access denied');
    return this.aiService.getThreadMessages(threadId, agentId);
  }

  @Delete('/threads/:threadId')
  @Permissions('base|read')
  async deleteThread(
    @Param('baseId') _baseId: string,
    @Param('threadId') threadId: string,
    @Query('agentId') agentId: string
  ) {
    const userId = this.cls.get('user').id;
    const thread = await this.aiService.getThread(threadId, agentId);
    if (!thread) return; // already gone — idempotent
    if (thread.resourceId !== userId) throw new ForbiddenException('Thread access denied');
    await this.aiService.deleteThread(threadId, agentId);
  }

  // ── TTS ──────────────────────────────────────────────────────────────────

  @Post('/tts')
  @Permissions('base|read')
  async tts(
    @Param('baseId') _baseId: string,
    @Body() body: { text?: string },
    @Res() res: Response
  ) {
    if (!body?.text?.trim()) throw new BadRequestException('text is required');
    await this.aiService.tts(body.text.trim(), res);
  }
}

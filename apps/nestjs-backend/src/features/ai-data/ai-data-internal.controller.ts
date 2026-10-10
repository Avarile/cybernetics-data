import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { filterSchema } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { orderBySchema } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { AiDataInternalGuard } from './ai-data-internal.guard';
import type { IAiDataInternalRequest } from './ai-data-internal.guard';
import { AiDataService } from './ai-data.service';

const tableId = z.string().startsWith('tbl');

/** Request bodies per operation. The base never comes from the body, only from the context. */
/* eslint-disable @typescript-eslint/naming-convention -- keys are URL path segments */
export const aiDataInternalBodies = {
  'list-tables': z.object({}).strict(),
  'describe-table': z.object({ tableId }).strict(),
  'query-records': z
    .object({
      tableId,
      search: z.string().optional(),
      filter: filterSchema.optional(),
      orderBy: orderBySchema.optional(),
      projection: z.array(z.string()).optional(),
      take: z.number().int().min(1).optional(),
      skip: z.number().int().min(0).optional(),
    })
    .strict(),
  'get-records': z.object({ tableId, recordIds: z.array(z.string()).min(1) }).strict(),
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

type IArgs<K extends IAiDataInternalOp> = z.infer<(typeof aiDataInternalBodies)[K]>;

export type IAiDataInternalOp = keyof typeof aiDataInternalBodies;

/**
 * Read-only data access for the Mastra service, acting as the user named in the
 * signed context. Public to the session guards; AiDataInternalGuard does the auth.
 */
@Controller('api/internal/ai-data')
@Public()
@UseGuards(AiDataInternalGuard)
export class AiDataInternalController {
  private readonly logger = new Logger(AiDataInternalController.name);

  constructor(
    private readonly aiDataService: AiDataService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Post(':op')
  @HttpCode(200)
  async run(
    @Param('op') op: string,
    @Body() body: unknown,
    @Req() req: IAiDataInternalRequest
  ): Promise<unknown> {
    const claims = req.aiDataContext;
    // The guard always sets this; refuse rather than run without a user.
    if (!claims) throw new UnauthorizedException();
    // Own keys only: `in` would also accept inherited names such as "toString".
    if (!Object.prototype.hasOwnProperty.call(aiDataInternalBodies, op)) {
      throw new NotFoundException(`Unknown operation: ${op}`);
    }

    const schema = aiDataInternalBodies[op as IAiDataInternalOp];
    const args = new ZodValidationPipe(schema).transform(body ?? {}, { type: 'body' });

    const user = await this.prismaService.user.findFirst({
      where: { id: claims.userId, deletedTime: null },
      select: { id: true, name: true, email: true, isAdmin: true, deactivatedTime: true },
    });
    if (!user || user.deactivatedTime) throw new UnauthorizedException();

    const store = {
      user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
      origin: {
        ip: req.ip ?? '',
        byApi: true,
        userAgent: String(req.headers['user-agent'] ?? 'mastra'),
        referer: '',
      },
      tx: {},
      permissions: [],
    } as unknown as IClsStore;

    try {
      return await this.cls.runWith(store, () =>
        this.dispatch(op as IAiDataInternalOp, claims.baseId, args)
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `AI data op "${op}" failed: ${error instanceof Error ? error.stack : String(error)}`
      );
      throw new InternalServerErrorException('The data lookup failed.');
    }
  }

  private dispatch(op: IAiDataInternalOp, baseId: string, args: unknown): Promise<unknown> {
    switch (op) {
      case 'list-tables':
        return this.aiDataService.listTables(baseId);
      case 'describe-table':
        return this.aiDataService.describeTable(baseId, (args as IArgs<'describe-table'>).tableId);
      case 'query-records':
        return this.aiDataService.queryRecords(baseId, args as IArgs<'query-records'>);
      case 'get-records': {
        const { tableId, recordIds } = args as IArgs<'get-records'>;
        return this.aiDataService.getRecords(baseId, tableId, recordIds);
      }
    }
  }
}

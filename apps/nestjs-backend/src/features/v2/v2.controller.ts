/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Controller } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { v2Contract } from '@teable/v2-contract-http';
import {
  executeCreateTableEndpoint,
  executeDeleteRecordsEndpoint,
  executeGetTableByIdEndpoint,
  executeUpdateRecordsEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { v2CoreTokens } from '@teable/v2-core';
import type { IQueryBus, ICommandBus } from '@teable/v2-core' with { 'resolution-mode': 'import' };
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';

const throwOrpcErrorByStatus = (status: number, message: string): never => {
  if (status === 400) {
    throw new ORPCError('BAD_REQUEST', { message });
  }

  if (status === 401) {
    throw new ORPCError('UNAUTHORIZED', { message });
  }

  if (status === 403) {
    throw new ORPCError('FORBIDDEN', { message });
  }

  if (status === 404) {
    throw new ORPCError('NOT_FOUND', { message });
  }

  throw new ORPCError('INTERNAL_SERVER_ERROR', { message });
};

@Controller('api/v2')
export class V2Controller {
  constructor(
    private readonly v2Container: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory
  ) {}

  // Each procedure is implemented separately so that it can declare its own
  // permission and resource. The v2 routes carry ids in the query or body, not
  // in the path, so the global PermissionGuard needs @ResourceMeta to find them.
  @Implement(v2Contract.tables.create)
  @Permissions('table|create')
  @ResourceMeta('baseId', 'body')
  createTable() {
    return implement(v2Contract.tables.create).handler(async ({ input }) => {
      const container = await this.v2Container.getContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const context = await this.v2ContextFactory.createContext();

      const result = await executeCreateTableEndpoint(context, input, commandBus);

      if (result.status === 201) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

  @Implement(v2Contract.tables.getById)
  @Permissions('table|read')
  @ResourceMeta('tableId', 'query')
  getTableById() {
    return implement(v2Contract.tables.getById).handler(async ({ input }) => {
      const container = await this.v2Container.getContainer();
      const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
      const context = await this.v2ContextFactory.createContext();

      const result = await executeGetTableByIdEndpoint(context, input, queryBus);
      if (result.status === 200) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

  @Implement(v2Contract.tables.deleteRecords)
  @Permissions('record|delete')
  @ResourceMeta('tableId', 'body')
  deleteRecords() {
    return implement(v2Contract.tables.deleteRecords).handler(async ({ input }) => {
      const container = await this.v2Container.getContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const context = await this.v2ContextFactory.createContext();

      const result = await executeDeleteRecordsEndpoint(context, input, commandBus);

      if (result.status === 200) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }

  @Implement(v2Contract.tables.updateRecords)
  @Permissions('record|update')
  @ResourceMeta('tableId', 'body')
  updateRecords() {
    return implement(v2Contract.tables.updateRecords).handler(async ({ input }) => {
      const container = await this.v2Container.getContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const context = await this.v2ContextFactory.createContext();

      const result = await executeUpdateRecordsEndpoint(context, input, commandBus);

      if (result.status === 200) return result.body;

      throwOrpcErrorByStatus(result.status, result.body.error);
    });
  }
}

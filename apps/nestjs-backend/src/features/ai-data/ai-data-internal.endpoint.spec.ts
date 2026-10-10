/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention, sonarjs/no-duplicate-string */
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AiDataInternalController } from './ai-data-internal.controller';

const claims = { userId: 'usr1', baseId: 'bseCTX', exp: 9e9 };
const dbUser = {
  id: 'usr1',
  name: 'Sam',
  email: 'sam@example.com',
  isAdmin: false,
  deactivatedTime: null,
};

const build = (overrides: { user?: any; aiData?: Record<string, any> } = {}) => {
  let clsStore: any;
  const cls = {
    runWith: vi.fn(async (store: any, fn: () => Promise<unknown>) => {
      clsStore = store;
      return fn();
    }),
  };
  const aiData = {
    listTables: vi.fn(async () => ['tables']),
    describeTable: vi.fn(async () => 'described'),
    queryRecords: vi.fn(async () => 'records'),
    getRecords: vi.fn(async () => 'byId'),
    ...overrides.aiData,
  };
  const prisma = {
    user: { findFirst: vi.fn(async () => ('user' in overrides ? overrides.user : dbUser)) },
  };
  const controller = new AiDataInternalController(aiData as any, prisma as any, cls as any);
  return { controller, aiData, prisma, cls, getStore: () => clsStore };
};

const req = (extra: Record<string, unknown> = {}) =>
  ({ aiDataContext: claims, headers: { 'user-agent': 'mastra' }, ip: '10.0.0.1', ...extra }) as any;

describe('AiDataInternalController', () => {
  it('runs the operation as the context user, in the context base, inside a fresh CLS store', async () => {
    const { controller, aiData, getStore } = build();
    await expect(controller.run('list-tables', {}, req())).resolves.toEqual(['tables']);

    expect(aiData.listTables).toHaveBeenCalledWith('bseCTX');
    expect(getStore()).toMatchObject({
      user: { id: 'usr1', name: 'Sam', email: 'sam@example.com', isAdmin: false },
      permissions: [],
      origin: { byApi: true },
    });
  });

  it('ignores any base id in the body: the context base wins', async () => {
    const { controller, aiData } = build();
    await expect(
      controller.run('query-records', { tableId: 'tbl1', baseId: 'bseOTHER' }, req())
    ).rejects.toThrow(BadRequestException); // strict schema: unknown keys are refused
    await controller.run('query-records', { tableId: 'tbl1', take: 5 }, req());
    expect(aiData.queryRecords).toHaveBeenCalledWith('bseCTX', { tableId: 'tbl1', take: 5 });
  });

  it('dispatches each operation with validated arguments', async () => {
    const { controller, aiData } = build();
    await controller.run('describe-table', { tableId: 'tbl1' }, req());
    await controller.run('get-records', { tableId: 'tbl1', recordIds: ['rec1'] }, req());
    await controller.run(
      'query-records',
      {
        tableId: 'tbl1',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fld1', operator: 'is', value: 'x' }],
        },
        orderBy: [{ fieldId: 'fld1', order: 'asc' }],
      },
      req()
    );
    expect(aiData.describeTable).toHaveBeenCalledWith('bseCTX', 'tbl1');
    expect(aiData.getRecords).toHaveBeenCalledWith('bseCTX', 'tbl1', ['rec1'], {
      fieldKeyType: undefined,
    });
    expect(aiData.queryRecords).toHaveBeenCalledTimes(1);
  });

  it('rejects bad arguments and unknown operations', async () => {
    const { controller, aiData } = build();
    await expect(controller.run('describe-table', { tableId: '   ' }, req())).rejects.toThrow(
      BadRequestException
    );
    await expect(
      controller.run('query-records', { tableId: 'tbl1', filter: { conjunction: 'maybe' } }, req())
    ).rejects.toThrow(BadRequestException);
    await expect(controller.run('delete-records', {}, req())).rejects.toThrow(NotFoundException);
    await expect(controller.run('__proto__', {}, req())).rejects.toThrow(NotFoundException);
    expect(aiData.describeTable).not.toHaveBeenCalled();
    expect(aiData.queryRecords).not.toHaveBeenCalled();
  });

  it('refuses when the guard did not attach a context', async () => {
    const { controller, aiData } = build();
    await expect(
      controller.run('list-tables', {}, req({ aiDataContext: undefined }))
    ).rejects.toThrow(UnauthorizedException);
    expect(aiData.listTables).not.toHaveBeenCalled();
  });

  it.each([
    ['missing or deleted', null],
    ['deactivated', { ...dbUser, deactivatedTime: new Date() }],
  ])('refuses a %s user', async (_label, user) => {
    const { controller, aiData } = build({ user });
    await expect(controller.run('list-tables', {}, req())).rejects.toThrow(UnauthorizedException);
    expect(aiData.listTables).not.toHaveBeenCalled();
  });

  it('passes permission errors through and hides unexpected ones', async () => {
    const denied = build({
      aiData: {
        listTables: vi.fn(async () => {
          throw new ForbiddenException('no permission');
        }),
      },
    });
    await expect(denied.controller.run('list-tables', {}, req())).rejects.toThrow('no permission');

    const broken = build({
      aiData: {
        listTables: vi.fn(async () => {
          throw new Error('db host 10.0.0.5 refused');
        }),
      },
    });
    const error = (await broken.controller
      .run('list-tables', {}, req())
      .catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).not.toContain('10.0.0.5');
  });
});

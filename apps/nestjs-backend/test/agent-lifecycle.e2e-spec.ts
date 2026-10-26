/**
 * /api/agent lifecycle routes (design §12): admins enable, check, disable and reset the agent;
 * everyone else gets 403 on every route.
 */
import { FieldKeyType } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  AGENT_DISABLE,
  AGENT_ENABLE,
  AGENT_RESET,
  AGENT_STATUS,
  AGENT_VERIFY,
  disableAgent,
  enableAgent,
  getAgentStatus,
  resetAgent,
  verifyAgent,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { getRecords, initApp, updateRecord } from './utils/init-app';

describe('Agent lifecycle routes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let member: AxiosInstance;
  const spaces: string[] = [];

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await prisma.agentInstallation.deleteMany({});
    member = await createNewUserAxios({
      email: 'agent-member@example.com',
      password: '12345678',
    });
  });

  afterAll(async () => {
    await prisma.space.updateMany({
      where: { id: { in: spaces } },
      data: { deletedTime: new Date() },
    });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('starts out not enabled', async () => {
    const status = await getAgentStatus();
    expect(status).toMatchObject({ enabled: false, status: 'needs_setup', models: [] });
    expect(status.warnings.map((w) => w.code)).toContain('not_enabled');
  });

  it('refuses every route to a non-admin', async () => {
    const calls = [
      () => member.get(AGENT_STATUS),
      () => member.post(AGENT_ENABLE),
      () => member.post(AGENT_DISABLE),
      () => member.post(AGENT_VERIFY),
      () => member.post(AGENT_RESET, { confirm: true }),
    ];
    for (const call of calls) {
      const error = await getError(call);
      expect(error?.status).toBe(403);
    }
    expect(await prisma.agentInstallation.count()).toBe(0);
  });

  it('enables, then reports the tables and a missing chat model', async () => {
    const status = await enableAgent();
    spaces.push(status.spaceId!);
    expect(status).toMatchObject({ enabled: true, status: 'ok' });
    expect(Object.keys(status.tables)).toHaveLength(6);
    expect(status.models.map((m) => m.slot)).toEqual([
      'model',
      'small_model',
      'embedding_model',
      'rerank_model',
    ]);
    expect(status.warnings.map((w) => w.code)).toContain('no_chat_model');
  });

  it('reports a chat model whose provider does not exist', async () => {
    const status = await getAgentStatus();
    const setupTable = status.tables.agent_setup;
    const [setup] = (await getRecords(setupTable, { fieldKeyType: FieldKeyType.Name })).records;
    await updateRecord(setupTable, setup.id, {
      fieldKeyType: FieldKeyType.Name,
      record: { fields: { model: 'no-such-provider/some-model' } },
    });

    const after = await getAgentStatus();
    expect(after.models[0]).toMatchObject({ slot: 'model', ref: 'no-such-provider/some-model' });
    expect(after.models[0].ok).toBe(false);
    expect(after.models[0].error).toMatch(/no-such-provider/);
    expect(after.warnings.map((w) => w.code)).toContain('model_unavailable');
  });

  it('verifies on demand', async () => {
    const before = await getAgentStatus();
    const status = await verifyAgent();
    expect(status.status).toBe('ok');
    expect(new Date(status.lastVerifiedTime!).getTime()).toBeGreaterThanOrEqual(
      new Date(before.lastVerifiedTime!).getTime()
    );
  });

  it('disables and re-enables without losing the base', async () => {
    const before = await getAgentStatus();
    const off = await disableAgent();
    expect(off).toMatchObject({ enabled: false, status: 'disabled' });
    const on = await enableAgent();
    expect(on).toMatchObject({ enabled: true, status: 'ok', baseId: before.baseId });
  });

  it('resets only with confirm, keeping the old base', async () => {
    const before = await getAgentStatus();
    const error = await getError(() => resetAgent({} as never));
    expect(error?.status).toBe(400);

    const status = await resetAgent({ confirm: true });
    expect(status.status).toBe('ok');
    expect(status.spaceId).toBe(before.spaceId);
    expect(status.baseId).not.toBe(before.baseId);
    const old = await prisma.base.findUniqueOrThrow({ where: { id: before.baseId! } });
    expect(old.deletedTime).toBeNull();
  });
});

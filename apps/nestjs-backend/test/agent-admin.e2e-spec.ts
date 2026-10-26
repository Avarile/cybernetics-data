/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Admin ▸ Agent routes (design §12, §13): the default setup, credentials metadata, the audit
 * log, and restoring the Agent base from the trash. Non-admins get 403 on all of them.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  AGENT_AUDIT,
  AGENT_CREDENTIALS,
  AGENT_RESTORE,
  AGENT_SETUP,
  deleteBase,
  enableAgent,
  getAgentAudit,
  getAgentSetup,
  getAgentStatus,
  listAgentCredentials,
  restoreAgent,
  updateAgentSetup,
  verifyAgent,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

describe('Agent admin routes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let member: AxiosInstance;
  let spaceId: string;

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await prisma.agentInstallation.deleteMany({});
    spaceId = (await enableAgent()).spaceId!;
    member = await createNewUserAxios({
      email: 'agent-admin-member@example.com',
      password: '12345678',
    });
  });

  afterAll(async () => {
    await prisma.space.update({ where: { id: spaceId }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('refuses every route to a non-admin', async () => {
    for (const call of [
      () => member.get(AGENT_SETUP),
      () => member.patch(AGENT_SETUP, { maxSteps: 3 }),
      () => member.get(AGENT_CREDENTIALS),
      () => member.get(AGENT_AUDIT),
      () => member.post(AGENT_RESTORE),
    ]) {
      expect((await getError(call))?.status).toBe(403);
    }
  });

  it('reads and changes the default setup, with validation', async () => {
    const setup = await getAgentSetup();
    expect(setup).toMatchObject({ name: 'Agent', memoryMode: 'explicit', maxSteps: 25 });
    expect(setup.toolkits).toContain('memory');

    const updated = await updateAgentSetup({
      model: 'openai/gpt-4.1',
      toolkits: ['memory', 'skills'],
      approvalRequired: ['delete_records'],
      memoryMode: 'auto',
      temperature: null,
    });
    expect(updated).toMatchObject({
      model: 'openai/gpt-4.1',
      toolkits: ['memory', 'skills'],
      approvalRequired: ['delete_records'],
      memoryMode: 'auto',
    });

    for (const bad of [
      { model: 'gpt-4.1' },
      { toolkits: ['root_shell'] },
      { maxSteps: 0 },
      { name: 'x' },
    ]) {
      expect((await getError(() => updateAgentSetup(bad as never)))?.status).toBe(400);
    }
  });

  it('lists credentials as metadata and the audit log newest first', async () => {
    expect(await listAgentCredentials()).toEqual({ credentials: [] });
    const audit = await getAgentAudit();
    expect(audit.items[0]).toMatchObject({ tool: 'setup.update', status: 'ok' });
    expect(audit.items.map((i) => i.tool)).toContain('installation.create');
    const created = await getAgentAudit({ runId: 'installation' });
    expect(created.items.every((i) => i.runId === 'installation')).toBe(true);
  });

  it('restores the Agent base from the trash', async () => {
    const before = await getAgentStatus();
    await deleteBase(before.baseId!);
    // the trash row is written by an event listener
    let trashed = 0;
    for (let i = 0; i < 50 && !trashed; i++) {
      trashed = await prisma.trash.count({ where: { resourceId: before.baseId! } });
      if (!trashed) await new Promise((r) => setTimeout(r, 100));
    }
    expect(trashed).toBe(1);
    expect((await verifyAgent()).status).toBe('needs_setup');

    const restored = await restoreAgent();
    expect(restored).toMatchObject({ status: 'ok', baseId: before.baseId });
    expect(await prisma.trash.count({ where: { resourceId: before.baseId! } })).toBe(0);
    const audit = await getAgentAudit();
    expect(audit.items.map((i) => i.tool)).toContain('installation.restore');
  });
});

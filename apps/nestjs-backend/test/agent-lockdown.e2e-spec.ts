/* eslint-disable sonarjs/no-duplicate-string */
/**
 * The Agent space is closed (design §7.1): no invitations, invite links, shares, template
 * publishing, base moves or hand-added collaborators; any that exist are revoked at the next check.
 * Other spaces behave as before.
 */
import { generateInvitationId, generateShareId, Role } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  ACCEPT_INVITATION_LINK,
  addBaseCollaborator,
  addSpaceCollaborator,
  createBaseInvitationLink,
  createBaseShare,
  createSpaceInvitationLink,
  createTemplate,
  deleteTemplate,
  emailBaseInvitation,
  emailSpaceInvitation,
  enableShareView,
  moveBase,
  PrincipalType,
  updateTemplate,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { ClsService } from 'nestjs-cls';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import type { IClsStore } from '../src/types/cls';
import { generateInvitationCode } from '../src/utils/code-generate';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createSpace,
  initApp,
  permanentDeleteSpace,
  runWithTestUser,
} from './utils/init-app';

describe('Agent space lock-down (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ensure: EnsureInstallation;
  let home: IAgentInstallationView;
  let otherSpaceId: string;
  let otherBaseId: string;
  let outsider: AxiosInstance;
  let outsiderId: string;

  const expect403 = async (call: () => unknown) => {
    const error = await getError(call);
    expect(error?.status).toBe(403);
    expect(error?.message).toBe('Managed by the Agent');
  };

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    ensure = app.get(EnsureInstallation);
    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => ensure.enable(globalThis.testConfig.userId), {
      isAdmin: true,
    });
    expect(home.status).toBe('ok');

    otherSpaceId = (await createSpace({ name: 'not the agent' })).id;
    otherBaseId = (await createBase({ spaceId: otherSpaceId, name: 'plain' })).id;
    outsider = await createNewUserAxios({
      email: 'agent-outsider@example.com',
      password: '12345678',
    });
    outsiderId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: 'agent-outsider@example.com' },
      })
    ).id;
  });

  afterAll(async () => {
    await permanentDeleteSpace(otherSpaceId);
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('refuses email invitations and invite links', async () => {
    const spaceId = home.spaceId!;
    const baseId = home.baseId!;
    await expect403(() =>
      emailSpaceInvitation({
        spaceId,
        emailSpaceInvitationRo: { emails: ['someone@example.com'], role: Role.Editor },
      })
    );
    await expect403(() =>
      emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { emails: ['someone@example.com'], role: Role.Editor },
      })
    );
    await expect403(() =>
      createSpaceInvitationLink({ spaceId, createSpaceInvitationLinkRo: { role: Role.Editor } })
    );
    await expect403(() =>
      createBaseInvitationLink({ baseId, createBaseInvitationLinkRo: { role: Role.Editor } })
    );
    expect(await prisma.invitation.count({ where: { spaceId } })).toBe(0);
  });

  it('refuses to accept an invite link that already existed', async () => {
    const id = generateInvitationId();
    await prisma.invitation.create({
      data: {
        id,
        invitationCode: generateInvitationCode(id),
        spaceId: home.spaceId!,
        role: Role.Editor,
        type: 'link',
        createdBy: globalThis.testConfig.userId,
      },
    });
    await expect403(() =>
      outsider.post(ACCEPT_INVITATION_LINK, {
        invitationId: id,
        invitationCode: generateInvitationCode(id),
      })
    );
    const members = await prisma.collaborator.findMany({ where: { resourceId: home.spaceId! } });
    expect(members.map((m) => m.principalId)).not.toContain(outsiderId);
  });

  it('refuses hand-added collaborators', async () => {
    const collaborators = [{ principalId: outsiderId, principalType: PrincipalType.User }];
    await expect403(() =>
      addSpaceCollaborator(home.spaceId!, { collaborators, role: Role.Editor })
    );
    await expect403(() => addBaseCollaborator(home.baseId!, { collaborators, role: Role.Editor }));
  });

  it('refuses base share links and view share links', async () => {
    await expect403(() => createBaseShare(home.baseId!, {}));
    const tableId = home.tableMap.agent_memory;
    const view = await prisma.view.findFirstOrThrow({ where: { tableId, deletedTime: null } });
    await expect403(() => enableShareView({ tableId, viewId: view.id }));
  });

  it('refuses moving the base out, and other bases in', async () => {
    await expect403(() => moveBase(home.baseId!, otherSpaceId));
    await expect403(() => moveBase(otherBaseId, home.spaceId!));
    const base = await prisma.base.findUniqueOrThrow({ where: { id: home.baseId! } });
    expect(base.spaceId).toBe(home.spaceId);
  });

  it('refuses publishing the base as a template', async () => {
    const template = (await createTemplate({})).data;
    await expect403(() => updateTemplate(template.id, { baseId: home.baseId! }));
    await deleteTemplate(template.id);
  });

  it('revokes invitations and shares that were written past the services', async () => {
    const tableId = home.tableMap.agent_memory;
    const view = await prisma.view.findFirstOrThrow({ where: { tableId, deletedTime: null } });
    await prisma.view.update({
      where: { id: view.id },
      data: { enableShare: true, shareId: generateShareId() },
    });
    await prisma.baseShare.create({
      data: {
        baseId: home.baseId!,
        shareId: generateShareId(),
        enabled: true,
        createdBy: globalThis.testConfig.userId,
      },
    });

    const checked = await ensure.ensure('e2e');
    // one link from the accept test above, one base share, one view share
    expect(checked.health).toMatchObject({
      revoked: { invitations: 1, baseShares: 1, viewShares: 1 },
    });
    expect(
      await prisma.invitation.count({ where: { spaceId: home.spaceId!, deletedTime: null } })
    ).toBe(0);
    expect(await prisma.baseShare.count({ where: { baseId: home.baseId!, enabled: true } })).toBe(
      0
    );
    const after = await prisma.view.findUniqueOrThrow({ where: { id: view.id } });
    expect(after.enableShare).toBeFalsy();

    const again = await ensure.ensure('e2e');
    expect(again.health).toMatchObject({
      revoked: { invitations: 0, baseShares: 0, viewShares: 0 },
    });
  });

  it('leaves other spaces alone', async () => {
    const link = await createSpaceInvitationLink({
      spaceId: otherSpaceId,
      createSpaceInvitationLinkRo: { role: Role.Editor },
    });
    expect(link.status).toBe(201);
    const share = await createBaseShare(otherBaseId, {});
    expect(share.status).toBe(201);
    await addSpaceCollaborator(otherSpaceId, {
      collaborators: [{ principalId: outsiderId, principalType: PrincipalType.User }],
      role: Role.Editor,
    });
    const members = await prisma.collaborator.findMany({ where: { resourceId: otherSpaceId } });
    expect(members.map((m) => m.principalId)).toContain(outsiderId);
  });
});

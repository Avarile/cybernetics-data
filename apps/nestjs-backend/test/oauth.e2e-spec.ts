import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { OAuthCreateVo } from '@teable/openapi';
import {
  deleteOAuthSecret,
  generateOAuthSecret,
  OAUTH_DELETE,
  OAUTH_GET,
  OAUTH_SECRET_GENERATE,
  OAUTH_UPDATE,
  oauthCreate,
  oauthDelete,
  oauthGet,
  oauthUpdate,
  urlBuilder,
} from '@teable/openapi';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

const oauthData = {
  name: 'test',
  redirectUris: ['http://localhost:3000/callback'],
  scopes: ['user|email_read'],
  homepage: 'http://localhost:3000',
};

describe('OpenAPI OAuthController (e2e)', () => {
  let app: INestApplication;
  let oauth: OAuthCreateVo;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    const res = await oauthCreate(oauthData);
    oauth = res.data;
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/oauth/client (POST)', async () => {
    const res = await oauthCreate(oauthData);
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('clientId');
  });

  it('/api/oauth/client/:clientId (GET)', async () => {
    const res = await oauthGet(oauth.clientId);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject(oauth);
  });

  it('/api/oauth/client/:clientId (GET) - not found', async () => {
    const error = await getError(() => oauthGet('xxxxxxx'));
    expect(error?.status).toBe(404);
  });

  it('/api/oauth/client/:clientId (DELETE)', async () => {
    const res = await oauthDelete(oauth.clientId);
    expect(res.status).toBe(200);
  });

  it('/api/oauth/client/:clientId (PUT)', async () => {
    const res = await oauthCreate(oauthData);
    const updated = await oauthUpdate(res.data.clientId, { ...res.data, name: 'updated' });
    expect(updated.data.name).toBe('updated');
  });

  it('/api/oauth/client/:clientId/secret (POST)', async () => {
    const res = await oauthCreate(oauthData);
    const secret = await generateOAuthSecret(res.data.clientId);
    expect(secret.data).toHaveProperty('secret');
    expect(secret.data.lastUsedTime).toBeUndefined();

    const oauth = await oauthGet(res.data.clientId);
    expect(oauth.data.secrets).toHaveLength(1);
    expect(oauth.data.secrets?.[0].secret).toEqual(secret.data.maskedSecret);
  });

  it('/api/oauth/client/:clientId/secret (DELETE)', async () => {
    const res = await oauthCreate(oauthData);
    const secret = await generateOAuthSecret(res.data.clientId);
    const deleted = await deleteOAuthSecret(res.data.clientId, secret.data.id);
    expect(deleted.status).toBe(200);

    const oauth = await oauthGet(res.data.clientId);
    expect(oauth.data.secrets).toBeUndefined();
  });

  it('test oauth app foreign key', async () => {
    const prisma = app.get(PrismaService);
    const clientId = 'test-client-id-' + Date.now();
    await prisma.oAuthApp.create({
      data: {
        name: 'test',
        clientId,
        createdBy: 'test',
        homepage: 'http://localhost:3000',
      },
    });
    const secret = await prisma.oAuthAppSecret.create({
      data: {
        clientId,
        secret: 'test-secret-' + Date.now(),
        maskedSecret: '**********',
        createdBy: 'test',
      },
    });
    await prisma.oAuthAppToken.create({
      data: {
        clientId,
        appSecretId: secret.id,
        refreshTokenSign: 'test-refresh-token-sign-' + Date.now(),
        expiredTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        createdBy: 'test',
      },
    });
    await prisma.oAuthAppAuthorized.create({
      data: {
        clientId,
        userId: 'test',
        authorizedTime: new Date(),
      },
    });
    await prisma.oAuthApp.delete({
      where: {
        clientId,
      },
    });

    const oauthRes = await prisma.oAuthApp.findUnique({
      where: {
        clientId,
      },
    });
    expect(oauthRes).toBeNull();

    const secretRes = await prisma.oAuthAppSecret.findMany({
      where: {
        clientId,
      },
    });
    expect(secretRes).toHaveLength(0);

    const tokenRes = await prisma.oAuthAppToken.findMany({
      where: {
        appSecretId: secret.id,
      },
    });
    expect(tokenRes).toHaveLength(0);

    const authorizedRes = await prisma.oAuthAppAuthorized.findMany({
      where: {
        clientId,
      },
    });
    expect(authorizedRes).toHaveLength(0);
  });

  it('rejects management of an OAuth app by a user who does not own it', async () => {
    const { data: ownApp } = await oauthCreate(oauthData);
    const otherUserAxios = await createNewUserAxios({
      email: 'oauth-other-user@example.com',
      password: '12345678',
    });
    const { clientId } = ownApp;

    const getErr = await getError(() => otherUserAxios.get(urlBuilder(OAUTH_GET, { clientId })));
    expect(getErr?.status).toBe(404);

    const updateErr = await getError(() =>
      otherUserAxios.put(urlBuilder(OAUTH_UPDATE, { clientId }), {
        ...oauthData,
        redirectUris: ['https://attacker.example.com/callback'],
      })
    );
    expect(updateErr?.status).toBe(404);

    const secretErr = await getError(() =>
      otherUserAxios.post(urlBuilder(OAUTH_SECRET_GENERATE, { clientId }))
    );
    expect(secretErr?.status).toBe(404);

    const deleteErr = await getError(() =>
      otherUserAxios.delete(urlBuilder(OAUTH_DELETE, { clientId }))
    );
    expect(deleteErr?.status).toBe(404);

    // The owner's app is untouched.
    const res = await oauthGet(clientId);
    expect(res.data.redirectUris).toEqual(oauthData.redirectUris);
  });
});

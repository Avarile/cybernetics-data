/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Credentials and http_request (design D4, §8, §9.3): a secret goes in only through the admin
 * route, is never returned, is injected server-side only for the credential's hosts and methods,
 * and is scrubbed from what the model sees.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  AGENT_CREDENTIAL_SECRET,
  deleteAgentCredentialSecret,
  enableAgent,
  getAgentAudit,
  listAgentCredentials,
  setAgentCredentialSecret,
  urlBuilder,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../src/features/agent/domain/ports';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { HttpToolkit } from '../src/features/agent/toolkits/http/http.toolkit';
import type { IToolContext } from '../src/features/agent/toolkits/toolkit.types';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

// the echo server below listens on loopback, which the SSRF guard blocks outside tests
process.env.AGENT_HTTP_ALLOW_PRIVATE_NETWORKS = 'true';

const secretValue = 'ghp_e2eSecretValue12345';

describe('Agent credentials and http_request (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: IAgentStorePort;
  let member: AxiosInstance;
  let server: http.Server;
  let host: string;
  let credentialId: string;
  let spaceId: string;
  const seen: { headers: http.IncomingHttpHeaders; url?: string; method?: string }[] = [];

  const request = async (input: Record<string, unknown>) => {
    const t = app.get(HttpToolkit).tools[0];
    return app
      .get(AgentExecutionContext)
      .run({ runId: 'e2e-http', actorUserId: globalThis.testConfig.userId }, () =>
        (t.execute as (i: unknown, c: IToolContext) => Promise<unknown>)(
          t.input.parse(input),
          {} as IToolContext
        )
      ) as Promise<{ status: number; body: string }>;
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ headers: req.headers, url: req.url, method: req.method });
      res.setHeader('content-type', 'application/json');
      res.setHeader('set-cookie', 'session=abc');
      // a careless API that echoes the token back
      res.end(JSON.stringify({ youSent: req.headers.authorization ?? null, path: req.url }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    host = `127.0.0.1:${(server.address() as AddressInfo).port}`;

    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
    await prisma.agentInstallation.deleteMany({});
    spaceId = (await enableAgent()).spaceId!;
    member = await createNewUserAxios({
      email: 'agent-cred-member@example.com',
      password: '12345678',
    });
    credentialId = (
      await store.createCredential({
        name: 'echo',
        authKind: 'bearer',
        allowedHosts: [host],
        allowedMethods: ['GET'],
      })
    ).id;
  });

  afterAll(async () => {
    server.close();
    await prisma.space.update({ where: { id: spaceId }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('takes the secret from admins only and never returns it', async () => {
    const url = urlBuilder(AGENT_CREDENTIAL_SECRET, { credentialId });
    expect((await getError(() => member.put(url, { value: secretValue })))?.status).toBe(403);

    const vo = await setAgentCredentialSecret(credentialId, { value: secretValue });
    expect(vo).toMatchObject({ status: 'set', preview: 'ghp_e…2345' });
    expect(JSON.stringify(vo)).not.toContain(secretValue);
    const list = await listAgentCredentials();
    expect(JSON.stringify(list)).not.toContain(secretValue);

    const stored = await prisma.agentSecret.findUniqueOrThrow({
      where: { credentialRecordId: credentialId },
    });
    expect(stored.ciphertext).toMatch(/^v1:/);
    expect(stored.ciphertext).not.toContain(secretValue);
    const cells = JSON.stringify(await store.listCredentials());
    expect(cells).not.toContain(secretValue);
  });

  it('injects the secret for allowed hosts and scrubs it from the reply', async () => {
    const res = await request({ method: 'GET', url: `http://${host}/user`, credential: 'echo' });
    expect(seen.at(-1)?.headers.authorization).toBe(`Bearer ${secretValue}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toContain(secretValue);
    expect(JSON.parse(res.body)).toEqual({ youSent: 'Bearer [redacted]', path: '/user' });
    expect(JSON.stringify(res)).not.toContain('session=abc');
    const used = await store.getCredentialByName('echo');
    expect(used?.lastUsedAt).toBeTruthy();
  });

  it('keeps the credential to its hosts and methods; without one, only listed hosts', async () => {
    await expect(
      request({ method: 'GET', url: 'http://127.0.0.2:9/', credential: 'echo' })
    ).rejects.toThrow(/may only be sent to/);
    await expect(
      request({ method: 'POST', url: `http://${host}/user`, credential: 'echo', body: '{}' })
    ).rejects.toThrow(/allows GET only/);
    await expect(request({ method: 'GET', url: `http://${host}/open` })).rejects.toThrow(
      /not allowed/
    );
    const t = app.get(HttpToolkit).tools[0];
    expect(typeof t.approval?.when).toBe('function');
    expect(t.approval!.when!({ method: 'GET' } as never)).toBe(false);
    expect(t.approval!.when!({ method: 'DELETE' } as never)).toBe(true);
  });

  it('removing the secret stops its use; the audit log never holds the value', async () => {
    const vo = await deleteAgentCredentialSecret(credentialId);
    expect(vo).toMatchObject({ status: 'missing', preview: null });
    await expect(
      request({ method: 'GET', url: `http://${host}/user`, credential: 'echo' })
    ).rejects.toThrow(/not set/);
    const audit = await getAgentAudit();
    const tools = audit.items.map((i) => i.tool);
    expect(tools).toEqual(expect.arrayContaining(['credential.set', 'credential.delete']));
    expect(JSON.stringify(audit)).not.toContain(secretValue);
  });
});

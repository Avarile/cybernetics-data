import type { ICredentialRef } from '../../domain/entities';
import type {
  IAgentStorePort,
  IAuditPort,
  IHttpPort,
  IHttpRequest,
  ISecretVaultPort,
} from '../../domain/ports';
import type { AgentExecutionContext } from '../../infrastructure/execution-context';
import { ManageCredentials } from './manage-credentials.usecase';

const setup = (status: ICredentialRef['status'], answer: number) => {
  const credential = {
    id: 'recC',
    name: 'github',
    allowedHosts: ['*.github.com', 'api.github.com'],
    status,
  } as ICredentialRef;
  const requests: IHttpRequest[] = [];
  const updateCredential = vi.fn(async () => credential);
  const usecase = new ManageCredentials(
    { listCredentials: async () => [credential], updateCredential } as unknown as IAgentStorePort,
    {} as ISecretVaultPort,
    {
      request: async (req: IHttpRequest) => {
        requests.push(req);
        return { status: answer, headers: {}, body: '', truncated: false };
      },
    } as IHttpPort,
    { append: async () => undefined } as IAuditPort,
    { run: (_scope: unknown, fn: () => unknown) => fn() } as unknown as AgentExecutionContext
  );
  return { usecase, requests, updateCredential };
};

describe('ManageCredentials.test', () => {
  it('tests a path on the first exact host, as a credential test', async () => {
    const { usecase, requests } = setup('set', 200);
    expect(await usecase.test('usrA', 'recC', '/user')).toEqual({ ok: true, status: 200 });
    expect(requests).toEqual([
      {
        method: 'GET',
        url: 'https://api.github.com/user',
        credential: 'github',
        credentialTest: true,
      },
    ]);
  });

  it('marks a rejected secret invalid, and a working one set again', async () => {
    const rejected = setup('set', 401);
    expect(await rejected.usecase.test('usrA', 'recC')).toMatchObject({ ok: false, status: 401 });
    expect(rejected.updateCredential).toHaveBeenCalledWith('recC', { status: 'invalid' });
    expect(rejected.requests[0].url).toBe('https://api.github.com/');

    const back = setup('invalid', 200);
    expect(await back.usecase.test('usrA', 'recC', '/user')).toMatchObject({ ok: true });
    expect(back.updateCredential).toHaveBeenCalledWith('recC', { status: 'set' });
  });
});

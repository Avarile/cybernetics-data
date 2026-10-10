import { describe, expect, it } from 'vitest';
import { buildSandboxEnv } from './general-agents';

describe('buildSandboxEnv', () => {
  it('passes only allow-listed variables to sandbox scripts', () => {
    const env = buildSandboxEnv({
      PATH: '/usr/bin',
      NODE_ENV: 'test',
      TEABLE_API_TOKEN: 'token',
      TEABLE_BASE_URL: 'http://localhost:3000',
      PRISMA_DATABASE_URL: 'postgresql://user:secret@db/app',
      DATABASE_URL: 'postgresql://user:secret@db/app',
      MASTRA_API_KEY: 'mastra-secret',
      OPENAI_API_KEY: 'sk-secret',
    });

    expect(env).toEqual({
      PATH: '/usr/bin',
      NODE_ENV: 'test',
      TEABLE_API_TOKEN: 'token',
      TEABLE_BASE_URL: 'http://localhost:3000',
    });
  });

  it('omits allow-listed variables that are not set', () => {
    expect(buildSandboxEnv({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
  });
});

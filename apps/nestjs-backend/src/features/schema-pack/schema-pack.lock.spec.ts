import { SchemaPackInstallLock } from './schema-pack.lock';

const logger = () => ({ debug: vi.fn(), warn: vi.fn() });

describe('SchemaPackInstallLock', () => {
  it('falls back to the process quietly when the cache is not Redis', async () => {
    const log = logger();
    const redis = {
      setnxex: vi.fn(async () => {
        throw new Error('RedisNativeService: Redis is not available (cache provider is not redis)');
      }),
    };
    const lock = new SchemaPackInstallLock(redis as never, log as never);
    const release = await lock.acquire('bseA');
    expect(log.debug).toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    await expect(lock.acquire('bseA')).rejects.toMatchObject({ status: 409 });
    await release();
    await expect(lock.acquire('bseA')).resolves.toBeTypeOf('function');
  });

  it('warns when a configured Redis fails, since other instances are no longer excluded', async () => {
    const log = logger();
    const redis = { setnxex: vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))) };
    const lock = new SchemaPackInstallLock(redis as never, log as never);
    await lock.acquire('bseB');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });
});

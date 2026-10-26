import { isTransientConflict, retryOnConflict } from './retry';

const deadlock = Object.assign(new Error(''), { code: 'P2010', meta: { code: '40P01' } });

describe('retryOnConflict', () => {
  it('recognises deadlocks and serialization failures only', () => {
    expect(isTransientConflict(deadlock)).toBe(true);
    expect(isTransientConflict({ code: 'P2034' })).toBe(true);
    expect(isTransientConflict(new Error('ERROR: deadlock detected'))).toBe(true);
    expect(isTransientConflict(new Error('Field does not exist'))).toBe(false);
    expect(isTransientConflict(undefined)).toBe(false);
  });

  it('reruns a write that deadlocked, and gives up after the attempts', async () => {
    let calls = 0;
    const flaky = async () => {
      if (++calls < 3) throw deadlock;
      return 'ok';
    };
    await expect(retryOnConflict(flaky)).resolves.toBe('ok');
    expect(calls).toBe(3);

    calls = 0;
    await expect(
      retryOnConflict(async () => {
        calls++;
        throw deadlock;
      }, 2)
    ).rejects.toBe(deadlock);
    expect(calls).toBe(2);
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(
      retryOnConflict(async () => {
        calls++;
        throw new Error('bad input');
      })
    ).rejects.toThrow('bad input');
    expect(calls).toBe(1);
  });
});

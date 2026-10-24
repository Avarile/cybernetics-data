import { randomBytes } from 'crypto';
import { IntegrationSecretCipher } from './integration-secret.cipher';

describe('IntegrationSecretCipher', () => {
  const cipher = new IntegrationSecretCipher(randomBytes(32));

  it('round-trips a value', () => {
    const secret = { accessToken: 'a', refreshToken: 'r', expiresAt: 1 };
    expect(cipher.decrypt(cipher.encrypt(secret, 'uin1'), 'uin1')).toEqual(secret);
  });

  it('uses a fresh IV for every value', () => {
    expect(cipher.encrypt({ password: 'p' }, 'uin1')).not.toBe(
      cipher.encrypt({ password: 'p' }, 'uin1')
    );
  });

  it('rejects a value moved to another row', () => {
    const value = cipher.encrypt({ password: 'p' }, 'uin1');
    expect(() => cipher.decrypt(value, 'uin2')).toThrow();
  });

  it('rejects a tampered value', () => {
    const [v, iv, tag, ct] = cipher.encrypt({ password: 'p' }, 'uin1').split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 1;
    expect(() =>
      cipher.decrypt([v, iv, tag, flipped.toString('base64')].join(':'), 'uin1')
    ).toThrow();
  });

  it('rejects a value encrypted with another key', () => {
    const other = new IntegrationSecretCipher(randomBytes(32));
    expect(() => cipher.decrypt(other.encrypt({ password: 'p' }, 'uin1'), 'uin1')).toThrow();
  });

  it('rejects keys of the wrong length', () => {
    expect(() =>
      IntegrationSecretCipher.fromConfig(randomBytes(16).toString('base64'), 'x')
    ).toThrow();
  });

  it('derives a stable key from the fallback secret', () => {
    const a = IntegrationSecretCipher.fromConfig(undefined, 'server-secret');
    const b = IntegrationSecretCipher.fromConfig(undefined, 'server-secret');
    expect(b.decrypt(a.encrypt({ password: 'p' }, 'uin1'), 'uin1')).toEqual({ password: 'p' });
  });
});

import { randomBytes } from 'crypto';
import { SecretCipher, secretPreview } from './secret-cipher';

describe('SecretCipher', () => {
  const masterKey = randomBytes(32).toString('base64');
  const cipher = SecretCipher.fromConfig(masterKey, 'unused', 'llm-provider');

  it('round-trips a value', () => {
    expect(cipher.decrypt(cipher.encrypt('sk-test-123', 'openrouter'), 'openrouter')).toBe(
      'sk-test-123'
    );
  });

  it('uses a fresh IV for every value', () => {
    expect(cipher.encrypt('k', 'a')).not.toBe(cipher.encrypt('k', 'a'));
  });

  it('rejects a value moved to another owner', () => {
    const value = cipher.encrypt('k', 'provider-a');
    expect(() => cipher.decrypt(value, 'provider-b')).toThrow();
  });

  it('keeps purposes apart', () => {
    const other = SecretCipher.fromConfig(masterKey, 'unused', 'agent-credential');
    const value = cipher.encrypt('k', 'x');
    expect(() => other.decrypt(value, 'x')).toThrow();
  });

  it('rejects a value encrypted under another key', () => {
    const other = SecretCipher.fromConfig(randomBytes(32).toString('base64'), 'u', 'llm-provider');
    expect(() => other.decrypt(cipher.encrypt('k', 'x'), 'x')).toThrow();
  });

  it('derives the same key from the fallback secret', () => {
    const a = SecretCipher.fromConfig(undefined, 'server-secret', 'llm-provider');
    const b = SecretCipher.fromConfig(undefined, 'server-secret', 'llm-provider');
    expect(b.decrypt(a.encrypt('k', 'x'), 'x')).toBe('k');
  });

  it('refuses a master key of the wrong length', () => {
    expect(() =>
      SecretCipher.fromConfig(randomBytes(16).toString('base64'), 'x', 'llm-provider')
    ).toThrow(/32 bytes/);
  });

  it('rejects unknown formats', () => {
    expect(() => cipher.decrypt('v2:a:b:c', 'x')).toThrow(/format/);
    expect(() => cipher.decrypt('plain-key', 'x')).toThrow();
  });

  it('recognises its own ciphertexts', () => {
    expect(SecretCipher.isCiphertext(cipher.encrypt('k', 'x'))).toBe(true);
    expect(SecretCipher.isCiphertext('sk-live-abc')).toBe(false);
    expect(SecretCipher.isCiphertext(undefined)).toBe(false);
  });
});

describe('secretPreview', () => {
  it('shows a short head and the last four characters', () => {
    expect(secretPreview('sk-or-v1-0123456789abcdef9f2c')).toBe('sk-or-…9f2c');
  });

  it('hides short secrets entirely', () => {
    expect(secretPreview('abc')).toBe('••••');
  });
});

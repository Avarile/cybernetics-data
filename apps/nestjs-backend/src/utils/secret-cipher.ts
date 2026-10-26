/* eslint-disable @typescript-eslint/naming-convention */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const HKDF_SALT = 'cybernetics-secret-cipher';

/**
 * Encrypts secrets (provider API keys, agent credentials) with AES-256-GCM and a random IV per
 * value, stored as `v1:<iv>:<tag>:<ciphertext>` (base64). Each purpose gets its own key, derived with
 * HKDF from one master key, so a ciphertext of one purpose never decrypts under another. `aad` binds a
 * value to its owner (a provider id, a credential record id), so a ciphertext copied elsewhere fails.
 */
export class SecretCipher {
  private readonly key: Buffer;

  private constructor(key: Buffer) {
    this.key = key;
  }

  /**
   * @param masterKey base64 32-byte key (BACKEND_SECRETS_ENCRYPTION_KEY); falls back to `fallbackSecret`
   * @param fallbackSecret server secret used when no master key is configured
   * @param purpose short label that separates keys, e.g. `llm-provider`, `agent-credential`
   */
  static fromConfig(masterKey: string | undefined, fallbackSecret: string, purpose: string) {
    let material: Buffer;
    if (masterKey) {
      material = Buffer.from(masterKey, 'base64');
      if (material.length !== KEY_BYTES) {
        throw new Error(`Secrets encryption key must be ${KEY_BYTES} bytes (base64)`);
      }
    } else {
      material = Buffer.from(fallbackSecret, 'utf8');
    }
    const derived = hkdfSync('sha256', material, HKDF_SALT, purpose, KEY_BYTES);
    return new SecretCipher(Buffer.from(derived));
  }

  static isCiphertext(value: unknown): value is string {
    return (
      typeof value === 'string' && value.startsWith(`${VERSION}:`) && value.split(':').length === 4
    );
  }

  encrypt<T>(data: T, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ciphertext]
      .map((p) => (Buffer.isBuffer(p) ? p.toString('base64') : p))
      .join(':');
  }

  decrypt<T>(value: string, aad: string): T {
    const [version, iv, tag, ciphertext] = value.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unsupported secret format');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  }
}

/** `sk-abc…9f2c`: enough to recognise a key, never enough to use it. */
export function secretPreview(secret: string): string {
  if (secret.length <= 8) return '••••';
  const head = secret.slice(0, Math.min(6, Math.floor(secret.length / 4)));
  return `${head}…${secret.slice(-4)}`;
}

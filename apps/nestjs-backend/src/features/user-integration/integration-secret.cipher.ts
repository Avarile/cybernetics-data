/* eslint-disable @typescript-eslint/naming-convention */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Encrypts integration secrets (OAuth tokens, mailbox passwords) with AES-256-GCM and a random
 * IV per value, stored as `v1:<iv>:<tag>:<ciphertext>` (base64). `aad` binds a value to its row,
 * so a ciphertext copied onto another integration fails to decrypt.
 */
export class IntegrationSecretCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new Error(`Integration encryption key must be ${KEY_BYTES} bytes`);
    }
    this.key = key;
  }

  /** From a base64 key, or derived from a server secret when no dedicated key is configured. */
  static fromConfig(encryptionKey: string | undefined, fallbackSecret: string) {
    if (encryptionKey) {
      return new IntegrationSecretCipher(Buffer.from(encryptionKey, 'base64'));
    }
    const derived = hkdfSync(
      'sha256',
      fallbackSecret,
      'cybernetics-user-integration',
      'secret-cipher',
      KEY_BYTES
    );
    return new IntegrationSecretCipher(Buffer.from(derived));
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
      throw new Error('Unsupported integration secret format');
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

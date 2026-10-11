import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyImportUrl } from './import-url';

describe('classifyImportUrl', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.PUBLIC_ORIGIN = 'https://app.example.com';
    delete process.env.STORAGE_PREFIX;
    process.env.BACKEND_STORAGE_MINIO_ENDPOINT = 'minio';
    delete process.env.BACKEND_STORAGE_PUBLIC_URL;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('accepts relative attachment read paths', () => {
    expect(classifyImportUrl('/api/attachments/read/private/abc?token=x')).toEqual({
      kind: 'relative',
      path: '/api/attachments/read/private/abc?token=x',
    });
  });

  it('rejects other relative paths', () => {
    expect(() => classifyImportUrl('/api/auth/user')).toThrow();
    expect(() => classifyImportUrl('//169.254.169.254/latest')).toThrow();
  });

  it('rejects non-http schemes and malformed values', () => {
    expect(() => classifyImportUrl('file:///etc/passwd')).toThrow();
    expect(() => classifyImportUrl('gopher://example.com')).toThrow();
    expect(() => classifyImportUrl('not a url')).toThrow();
  });

  it('trusts configured storage hosts', () => {
    const target = classifyImportUrl('http://minio:9000/private/file.csv?X-Amz-Signature=1');
    expect(target).toMatchObject({ kind: 'absolute', trusted: true });
  });

  it('trusts the app origin only for attachment reads', () => {
    expect(
      classifyImportUrl('https://app.example.com/api/attachments/read/private/abc')
    ).toMatchObject({ trusted: true });
    expect(classifyImportUrl('https://app.example.com/api/auth/user')).toMatchObject({
      trusted: false,
    });
  });

  it('marks other public URLs as untrusted', () => {
    expect(classifyImportUrl('https://example.com/data.csv')).toMatchObject({
      kind: 'absolute',
      trusted: false,
    });
    expect(classifyImportUrl('http://169.254.169.254/latest/meta-data')).toMatchObject({
      trusted: false,
    });
  });
});

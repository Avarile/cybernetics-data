/* eslint-disable @typescript-eslint/naming-convention, sonarjs/no-duplicate-string */
import { auditJson, redact } from './redact';

describe('redact', () => {
  it('hides values under secret-looking keys at any depth', () => {
    expect(
      redact({
        url: 'https://api',
        headers: { Authorization: 'Bearer x', 'X-Api-Key': 'k' },
        apiKey: 's',
      })
    ).toEqual({
      url: 'https://api',
      headers: { Authorization: '[redacted]', 'X-Api-Key': '[redacted]' },
      apiKey: '[redacted]',
    });
  });

  it('caps long strings and the whole audit row', () => {
    expect(String(redact('a'.repeat(3000)))).toMatch(/…\[3000\]$/);
    expect(
      auditJson({ rows: Array.from({ length: 50 }, () => 'b'.repeat(1000)) }).length
    ).toBeLessThanOrEqual(8001);
  });
});

import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { signAiDataContext, verifyAiDataContext } from './ai-data-context';

const secret = 'a'.repeat(48);
const now = 1_800_000_000;
const claims = {
  userId: 'usrABC',
  baseId: 'bseABC',
  requestId: '0b8f2c1e-1111-4222-8333-444455556666',
  exp: now + 120,
};

describe('signAiDataContext / verifyAiDataContext', () => {
  it('round-trips valid claims', () => {
    const token = signAiDataContext(claims, secret);
    expect(token.startsWith('v1.')).toBe(true);
    expect(verifyAiDataContext(token, secret, now)).toEqual({ ok: true, claims });
  });

  it('rejects a token signed with another secret', () => {
    const token = signAiDataContext(claims, 'b'.repeat(48));
    expect(verifyAiDataContext(token, secret, now)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token whose claims were changed after signing (other base or user)', () => {
    const token = signAiDataContext(claims, secret);
    const [v, , sig] = token.split('.');
    for (const forged of [
      { ...claims, baseId: 'bseOTHER' },
      { ...claims, userId: 'usrADMIN' },
      { ...claims, exp: now + 10_000 },
    ]) {
      const payload = Buffer.from(JSON.stringify(forged)).toString('base64url');
      expect(verifyAiDataContext(`${v}.${payload}.${sig}`, secret, now)).toEqual({
        ok: false,
        reason: 'bad-signature',
      });
    }
  });

  it('rejects an expired token, including exactly at expiry', () => {
    const token = signAiDataContext(claims, secret);
    expect(verifyAiDataContext(token, secret, claims.exp)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(verifyAiDataContext(token, secret, claims.exp + 1).ok).toBe(false);
  });

  it.each([
    undefined,
    '',
    'v1.abc',
    'v2.abc.def',
    'v1.a.b.c',
    'x'.repeat(5000),
    123,
    ['v1', 'a', 'b'],
  ])('rejects malformed input %#', (token) => {
    const result = verifyAiDataContext(token, secret, now);
    expect(result.ok).toBe(false);
  });

  it('rejects a correctly signed payload that is not valid claims', () => {
    const payload = Buffer.from(JSON.stringify({ userId: 'notAUser', baseId: 'bse1' })).toString(
      'base64url'
    );
    const sig = createHmac('sha256', secret).update(`v1.${payload}`).digest('base64url');
    expect(verifyAiDataContext(`v1.${payload}.${sig}`, secret, now)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('refuses to sign invalid claims', () => {
    expect(() => signAiDataContext({ ...claims, baseId: 'tblWRONG' }, secret)).toThrow();
  });
});

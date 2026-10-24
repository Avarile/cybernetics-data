import { describe, expect, it } from 'vitest';
import { getSafeUrl, isSafeUrl } from './safeUrl';

const safeUrl = 'https://example.com';
const scriptUrl = 'javascript:alert(1)';

describe('isSafeUrl', () => {
  it.each([
    safeUrl,
    'http://example.com/a?b=1',
    'mailto:a@b.com',
    'tel:+123',
    '/a/b',
    'a/b',
    '#anchor',
  ])('allows %s', (url) => {
    expect(isSafeUrl(url)).toBe(true);
  });

  it.each([
    scriptUrl,
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    '\u0001javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('rejects %j', (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });

  it('rejects empty values', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
  });
});

describe('getSafeUrl', () => {
  it('returns the url when safe and undefined otherwise', () => {
    expect(getSafeUrl(safeUrl)).toBe(safeUrl);
    expect(getSafeUrl(scriptUrl)).toBeUndefined();
  });
});

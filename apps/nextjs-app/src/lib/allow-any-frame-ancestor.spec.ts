import { allowAnyFrameAncestor } from './allow-any-frame-ancestor';

const CSP = 'Content-Security-Policy';

const createRes = (csp?: string | string[]) => {
  const headers: Record<string, unknown> = {};
  if (csp !== undefined) headers[CSP] = csp;
  return {
    headers,
    getHeader: (name: string) => headers[name] as string | string[] | undefined,
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this as never;
    },
  };
};

describe('allowAnyFrameAncestor', () => {
  it('keeps the existing policy and adds frame-ancestors', () => {
    const res = createRes("default-src 'self'; script-src 'self'");
    allowAnyFrameAncestor(res);
    expect(res.headers[CSP]).toBe("default-src 'self'; script-src 'self'; frame-ancestors *");
  });

  it('replaces an existing frame-ancestors directive', () => {
    const res = createRes("default-src 'self'; frame-ancestors 'none';");
    allowAnyFrameAncestor(res);
    expect(res.headers[CSP]).toBe("default-src 'self'; frame-ancestors *");
  });

  it('sets frame-ancestors alone when there is no policy', () => {
    for (const csp of [undefined, '']) {
      const res = createRes(csp);
      allowAnyFrameAncestor(res);
      expect(res.headers[CSP]).toBe('frame-ancestors *');
    }
  });
});

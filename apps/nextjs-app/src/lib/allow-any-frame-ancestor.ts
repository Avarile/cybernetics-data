import type { ServerResponse } from 'http';

const CSP_HEADER = 'Content-Security-Policy';

/**
 * Lets any site embed the page in an iframe. The CSP set in next.config.js is already on the
 * response, so frame-ancestors is merged into it; replacing the header would drop the policy.
 */
export const allowAnyFrameAncestor = (res: Pick<ServerResponse, 'getHeader' | 'setHeader'>) => {
  const current = res.getHeader(CSP_HEADER);
  const directives = String(Array.isArray(current) ? current.join(';') : current ?? '')
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive && !/^frame-ancestors\b/i.test(directive));
  res.setHeader(CSP_HEADER, [...directives, 'frame-ancestors *'].join('; '));
};

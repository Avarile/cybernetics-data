// This file is required by Next.js 15+ for Sentry integration
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  // Edge Runtime config - create sentry.edge.config.ts if using Middleware or Edge API Routes
  // if (process.env.NEXT_RUNTIME === 'edge') {
  //   await import('./sentry.edge.config');
  // }
}

export const onRequestError = async (
  err: Error,
  request: {
    path: string;
    method: string;
    headers: Record<string, string>;
  },
  context: {
    routerKind: string;
    routePath: string;
    routeType: string;
    renderSource?: string;
    revalidateReason?: string;
    serverComponentType?: string;
  }
) => {
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureException(err, {
    extra: {
      request: { ...request, headers: redactHeaders(request.headers) },
      context,
    },
  });
};

// Session cookies and tokens would let anyone who can read the Sentry event act as the user.
const SENSITIVE_HEADERS = new Set(['cookie', 'authorization', 'proxy-authorization', 'x-api-key']);

const redactHeaders = (headers: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [
      key,
      SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value,
    ])
  );

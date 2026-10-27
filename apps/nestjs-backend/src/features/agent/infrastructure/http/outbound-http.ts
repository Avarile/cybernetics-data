import { lookup } from 'dns/promises';
import http from 'http';
import https from 'https';
import { isIP } from 'net';
import { HttpErrorCode } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import { AgentConfig, type IAgentConfig } from '../../../../configs/agent.config';
import { CustomHttpException } from '../../../../custom.exception';
import type { ICredentialRef } from '../../domain/entities';
import {
  AGENT_STORE_PORT,
  SECRET_VAULT_PORT,
  type IAgentStorePort,
  type IHttpPort,
  type IHttpRequest,
  type IHttpResponse,
  type ISecretVaultPort,
} from '../../domain/ports';
import { hostAllowed, isBlockedAddress, parseHostList } from './network-policy';

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
/** Headers the model may not set (connection-level, or ones the credential decides). */
const reserved =
  /^(?:host|connection|content-length|transfer-encoding|upgrade|te|trailer|proxy-.*|cookie)$/i;
const keptResponseHeaders =
  /^(?:content-type|location|retry-after|x-ratelimit-.*|etag|last-modified)$/i;

const refuse = (message: string) =>
  new CustomHttpException(message, HttpErrorCode.VALIDATION_ERROR);

const userAgentHeader = 'user-agent';

/** The model's headers, lower-cased, without the ones it may not set. */
export const sanitizeHeaders = (input: Record<string, string> | undefined) =>
  Object.fromEntries(
    Object.entries(input ?? {})
      .filter(([k]) => !reserved.test(k))
      .map(([k, v]) => [k.toLowerCase(), String(v)])
  ) as Record<string, string>;

/** Every form the secret may take in a response, longest first. */
export const secretForms = (secret: string, kind: string | null) =>
  [
    secret,
    kind === 'basic' ? Buffer.from(secret).toString('base64') : '',
    encodeURIComponent(secret),
  ]
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length);

export const scrub = (text: string, forms: string[]) =>
  forms.reduce((out, form) => out.split(form).join('[redacted]'), text);

/** Puts the secret where the credential says (design §8); the model never sees it. */
export function inject(
  credential: Pick<ICredentialRef, 'authKind' | 'headerName' | 'queryParam'>,
  secret: string,
  url: URL,
  headers: Record<string, string>
) {
  switch (credential.authKind) {
    case 'bearer':
      headers.authorization = `Bearer ${secret}`;
      return;
    case 'basic':
      headers.authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
      return;
    case 'header':
      if (!credential.headerName) throw refuse('The credential has no header_name');
      headers[credential.headerName.toLowerCase()] = secret;
      return;
    case 'query_param':
      if (!credential.queryParam) throw refuse('The credential has no query_param');
      url.searchParams.set(credential.queryParam, secret);
      return;
    default:
      throw refuse(`Credentials of kind ${credential.authKind} are not supported yet`);
  }
}

/**
 * HttpPort with the SSRF guard (design §9.3): allowed hosts only (a credential's, or
 * AGENT_HTTP_ALLOWED_HOSTS), public addresses only after DNS resolution, connection pinned to the
 * checked address, no redirects followed, time and size limits, secrets scrubbed from replies.
 */
@Injectable()
export class OutboundHttp implements IHttpPort {
  constructor(
    @AgentConfig() private readonly config: IAgentConfig,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @Inject(SECRET_VAULT_PORT) private readonly vault: ISecretVaultPort
  ) {}

  async request(req: IHttpRequest): Promise<IHttpResponse> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      throw refuse('Not a valid URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw refuse('Only http and https');
    if (url.username || url.password) throw refuse('Put credentials in a credential, not the URL');
    const method = req.method.toUpperCase();
    if (!methods.includes(method)) throw refuse(`Method ${method} is not allowed`);

    const headers = sanitizeHeaders(req.headers);

    let forms: string[] = [];
    let credential: ICredentialRef | undefined;
    if (req.credential) {
      credential = await this.authorize(req.credential, url, method, req.credentialTest);
      const secret = await this.vault.reveal(credential.id);
      if (!secret) throw refuse(`The secret of ${credential.name} is not set; ask the admin`);
      delete headers.authorization;
      inject(credential, secret, url, headers);
      forms = secretForms(secret, credential.authKind);
    } else if (!hostAllowed(url, parseHostList(this.config.httpAllowedHosts))) {
      throw refuse(
        `${url.hostname} is not allowed. Use a credential that lists it, or ask the admin to add it to AGENT_HTTP_ALLOWED_HOSTS.`
      );
    }

    const address = await this.resolve(url.hostname);
    const response = await this.send(url, method, headers, req.body, address);
    if (credential) {
      await this.store
        .updateCredential(credential.id, { lastUsedAt: new Date().toISOString() })
        .catch(() => undefined);
    }
    return {
      ...response,
      body: scrub(response.body, forms),
      ...(response.location ? { location: scrub(response.location, forms) } : {}),
    };
  }

  private async authorize(name: string, url: URL, method: string, test = false) {
    const credential = await this.store.getCredentialByName(name);
    if (!credential) throw refuse(`No credential named ${name}; use credential_request`);
    const usable = credential.status === 'set' || (test && credential.status === 'invalid');
    if (!usable) {
      throw refuse(
        credential.status === 'invalid'
          ? `The secret of ${name} was rejected; ask the admin to check it`
          : `The secret of ${name} is not set; ask the admin`
      );
    }
    if (credential.expiresAt && new Date(credential.expiresAt).getTime() < Date.now()) {
      throw refuse(`The credential ${name} has expired`);
    }
    if (!hostAllowed(url, credential.allowedHosts)) {
      throw refuse(
        `${name} may only be sent to ${credential.allowedHosts.join(', ') || '(no hosts)'}`
      );
    }
    const allowed = credential.allowedMethods.length ? credential.allowedMethods : ['GET'];
    const asked = method === 'HEAD' ? 'GET' : method;
    if (!allowed.includes(asked)) throw refuse(`${name} allows ${allowed.join(', ')} only`);
    return credential;
  }

  /** A public address for the host, or a refusal. */
  private async resolve(hostname: string) {
    const host = hostname.replace(/^\[|\]$/g, '');
    const found = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true }).catch(() => {
          throw refuse(`Cannot resolve ${host}`);
        });
    if (this.config.httpAllowPrivateNetworks) return found[0];
    if (!found.length || found.some((a) => isBlockedAddress(a.address))) {
      throw refuse(`${host} resolves to a private or reserved address`);
    }
    return found[0];
  }

  private send(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    address: { address: string; family: number }
  ): Promise<Omit<IHttpResponse, 'body'> & { body: string }> {
    const client = url.protocol === 'https:' ? https : http;
    const max = this.config.httpMaxResponseBytes;
    return new Promise((resolve, reject) => {
      const request = client.request(
        url,
        {
          method,
          headers: { [userAgentHeader]: 'cybernetics-agent', ...headers },
          timeout: this.config.httpTimeoutMs,
          // pin the connection to the address that was checked
          lookup: (_host, options, callback) => {
            const cb = callback as (...args: unknown[]) => void;
            if ((options as { all?: boolean })?.all) cb(null, [address]);
            else cb(null, address.address, address.family);
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          res.on('data', (chunk: Buffer) => {
            if (truncated) return;
            size += chunk.length;
            if (size > max) {
              truncated = true;
              chunks.push(chunk.subarray(0, chunk.length - (size - max)));
              res.destroy();
              return;
            }
            chunks.push(chunk);
          });
          const done = () => {
            const kept = Object.fromEntries(
              Object.entries(res.headers)
                .filter(([k]) => keptResponseHeaders.test(k))
                .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])
            );
            const status = res.statusCode ?? 0;
            resolve({
              status,
              headers: kept,
              body: Buffer.concat(chunks).toString('utf8'),
              truncated,
              ...(status >= 300 && status < 400 && res.headers.location
                ? { location: new URL(res.headers.location, url).toString() }
                : {}),
            });
          };
          res.on('end', done);
          res.on('close', done);
          res.on('error', reject);
        }
      );
      request.on('timeout', () => request.destroy(refuse('The request timed out')));
      request.on('error', reject);
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') request.write(body);
      request.end();
    });
  }
}

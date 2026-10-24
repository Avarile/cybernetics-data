/* eslint-disable @typescript-eslint/naming-convention */
import { isIP } from 'net';
import { Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import type { ImapFlowOptions } from 'imapflow';
import { createTransport } from 'nodemailer';
import { resolvePublicHost } from '../../utils/ssrf-guard';

export interface IMailServerCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

const CONNECTION_TIMEOUT = 15_000;
const GREETING_TIMEOUT = 10_000;
const SOCKET_TIMEOUT = 30_000;

const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

/** A short reason for the user; server banners and stack traces stay in the log. */
export const describeMailServerError = (error: unknown): string => {
  const err = (error ?? {}) as {
    code?: string;
    message?: string;
    authenticationFailed?: boolean;
    responseCode?: number;
  };
  const message = err.message ?? '';
  // Microsoft 365 and some Gmail accounts turn password logins off entirely
  if (/login is disabled|logindisabled/i.test(message)) {
    return 'Password login is disabled for this mailbox. Connect it with Gmail or Microsoft sign-in instead.';
  }
  if (err.authenticationFailed || err.code === 'EAUTH' || err.responseCode === 535) {
    return 'Authentication failed. Check the username and password; many providers require an app password.';
  }
  if (message.includes('resolves to a private address')) {
    return 'The host resolves to a private network address, which is not allowed.';
  }
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || message.includes('did not resolve')) {
    return 'The host could not be found.';
  }
  if (err.code === 'ECONNREFUSED') {
    return 'The connection was refused. Check the host and port.';
  }
  if (err.code === 'ETIMEDOUT' || err.code === 'ETIMEOUT' || /timed? ?out/i.test(message)) {
    return 'The connection timed out. Check the host, port and security setting.';
  }
  if ((err.code && TLS_ERROR_CODES.has(err.code)) || /certificate|tls|ssl/i.test(message)) {
    return 'A secure connection could not be established. Check the port and security setting.';
  }
  if (/starttls/i.test(message)) {
    return 'The server does not support STARTTLS. Use a port with implicit TLS instead.';
  }
  return 'Could not connect to the server.';
};

const resolveMailHost = async (host: string, allowPrivateHosts: boolean) =>
  allowPrivateHosts ? host : await resolvePublicHost(host);

/**
 * An IMAP client for a user-supplied server. Unless private hosts are allowed, the host is
 * resolved once, private addresses are rejected and the socket goes to the vetted address, with
 * the hostname kept for TLS. Plaintext logins are never attempted: without implicit TLS, STARTTLS
 * is required. The caller connects and closes it.
 */
export const createImapClient = async (
  server: IMailServerCredentials,
  options: { allowPrivateHosts: boolean; verifyOnly?: boolean; logger: Logger }
) => {
  const address = await resolveMailHost(server.host, options.allowPrivateHosts);
  // SNI only takes host names (RFC 6066)
  const servername = isIP(server.host) ? undefined : server.host;
  // doSTARTTLS is supported at runtime but missing from imapflow's types
  const imapOptions: ImapFlowOptions & { doSTARTTLS?: boolean } = {
    host: address,
    port: server.port,
    secure: server.secure,
    servername,
    ...(server.secure ? {} : { doSTARTTLS: true }),
    auth: { user: server.username, pass: server.password },
    tls: { servername },
    logger: false,
    verifyOnly: options.verifyOnly,
    disableAutoIdle: true,
    connectionTimeout: CONNECTION_TIMEOUT,
    greetingTimeout: GREETING_TIMEOUT,
    socketTimeout: SOCKET_TIMEOUT,
  };
  const client = new ImapFlow(imapOptions);
  // errors also reject the pending command; without a listener an 'error' event would crash the process
  client.on('error', (error) => options.logger.debug(`IMAP ${server.host}: ${error}`));
  return client;
};

/** Logs in to an IMAP or SMTP server to check credentials (see createImapClient). */
export class MailServerTester {
  private readonly logger = new Logger(MailServerTester.name);

  constructor(private readonly allowPrivateHosts: boolean) {}

  async testImap(server: IMailServerCredentials): Promise<void> {
    const client = await createImapClient(server, {
      allowPrivateHosts: this.allowPrivateHosts,
      verifyOnly: true,
      logger: this.logger,
    });
    try {
      await client.connect();
    } finally {
      client.close();
    }
  }

  async testSmtp(server: IMailServerCredentials): Promise<void> {
    const address = await resolveMailHost(server.host, this.allowPrivateHosts);
    const servername = isIP(server.host) ? undefined : server.host;
    const transport = createTransport({
      host: address,
      port: server.port,
      secure: server.secure,
      requireTLS: !server.secure,
      auth: { user: server.username, pass: server.password },
      tls: { servername },
      connectionTimeout: CONNECTION_TIMEOUT,
      greetingTimeout: GREETING_TIMEOUT,
      socketTimeout: SOCKET_TIMEOUT,
    });
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  }
}

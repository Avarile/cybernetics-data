/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Credential secrets (design D4): never in table cells, never returned by any API or tool.
 * Only the outbound HTTP adapter reads a value, to inject it into a request.
 */
export interface ISecretVaultPort {
  set(
    credentialId: string,
    value: string,
    actorUserId: string,
    expiresAt?: string | null
  ): Promise<void>;
  delete(credentialId: string): Promise<void>;
  has(credentialId: string): Promise<boolean>;
  /** The plain value, for the outbound request only; records last use. */
  reveal(credentialId: string): Promise<string | undefined>;
  /** What the admin sees of each secret (e.g. ghp_e…2345); never given to the agent. */
  previews(credentialIds: string[]): Promise<Map<string, string | null>>;
}

export const SECRET_VAULT_PORT = Symbol('AGENT_SECRET_VAULT_PORT');

export interface IHttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Name of an agent_credentials row whose secret is injected server-side. */
  credential?: string;
  /**
   * The admin's credential test: a credential marked invalid may be used, to find out whether it
   * works again. No tool sets it (tools pass their parsed input only).
   */
  credentialTest?: boolean;
}

export interface IHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  /** A redirect is not followed; call again with this URL if it is allowed. */
  location?: string;
}

export interface IHttpPort {
  request(req: IHttpRequest): Promise<IHttpResponse>;
}

export const HTTP_PORT = Symbol('AGENT_HTTP_PORT');

/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const agentConfig = registerAs('agent', () => ({
  /** Hosts http_request may call without a credential (comma separated, `*.` for subdomains). */
  httpAllowedHosts: process.env.AGENT_HTTP_ALLOWED_HOSTS ?? '',
  /**
   * Development and tests only: let http_request reach private and loopback addresses.
   * Never set this in production; it disables the SSRF guard's address check.
   */
  httpAllowPrivateNetworks: process.env.AGENT_HTTP_ALLOW_PRIVATE_NETWORKS === 'true',
  httpTimeoutMs: positive(process.env.AGENT_HTTP_TIMEOUT_MS, 20_000),
  /** Response bodies are cut after this many bytes before the model sees them. */
  httpMaxResponseBytes: positive(process.env.AGENT_HTTP_MAX_RESPONSE_BYTES, 200_000),
}));

export const AgentConfig = () => Inject(agentConfig.KEY);

export type IAgentConfig = ConfigType<typeof agentConfig>;

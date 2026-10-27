/* eslint-disable @typescript-eslint/naming-convention */
import { AGENT_SCHEMA_PACK_ID } from '@teable/openapi';
import { buildCatalog } from '../../schema-pack/schema-pack.catalog';
import type { ISchemaPackCatalog } from '../../schema-pack/schema-pack.catalog';
import agentPackJson from './agent.pack.json';

/** Table keys of the agent pack, as the store addresses them. */
export const AGENT_TABLES = {
  setup: 'agent_setup',
  memory: 'agent_memory',
  threads: 'agent_threads',
  messages: 'agent_messages',
  skills: 'agent_skills',
  credentials: 'agent_credentials',
} as const;
export type IAgentTableKey = (typeof AGENT_TABLES)[keyof typeof AGENT_TABLES];

export const AGENT_PACK_VERSION = agentPackJson.version;

/**
 * Fields the pack no longer has. An install that still has one (found by the id stored for it,
 * never by name) drops it on the next check.
 */
export const RETIRED_AGENT_FIELDS: Partial<Record<IAgentTableKey, string[]>> = {
  // the secret preview moved to agent_secret, out of the agent's reach (pack version 2)
  [AGENT_TABLES.credentials]: ['preview'],
};

let cached: ISchemaPackCatalog | undefined;

/** The agent pack as its own catalog, separate from the user-facing pack wizard. */
export const getAgentPackCatalog = (): ISchemaPackCatalog =>
  (cached ??= buildCatalog({ packs: [agentPackJson], bridges: [], seeds: [] }, [
    AGENT_SCHEMA_PACK_ID,
  ]));

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

let cached: ISchemaPackCatalog | undefined;

/** The agent pack as its own catalog, separate from the user-facing pack wizard. */
export const getAgentPackCatalog = (): ISchemaPackCatalog =>
  (cached ??= buildCatalog({ packs: [agentPackJson], bridges: [], seeds: [] }, [
    AGENT_SCHEMA_PACK_ID,
  ]));

import {
  AGENT_DATA_PART,
  searchHitPartSchema,
  searchLensPartSchema,
  searchPlanPartSchema,
  searchStepPartSchema,
} from '@teable/openapi';
import type { IBoardEvent } from '../model/search-board';
import type { IAgentDataChunk } from './agent-chat';

/**
 * A data part of the stream as a board event (cockpit design §7.1), checked against the shared
 * contract first: a part that does not fit is ignored, not trusted.
 */
export function boardEventOf(chunk: IAgentDataChunk): IBoardEvent | undefined {
  switch (chunk.type) {
    case AGENT_DATA_PART.searchPlan: {
      const p = searchPlanPartSchema.safeParse(chunk.data);
      return p.success ? { type: 'plan', ...p.data } : undefined;
    }
    case AGENT_DATA_PART.searchStep: {
      const p = searchStepPartSchema.safeParse(chunk.data);
      return p.success ? { type: 'step', ...p.data } : undefined;
    }
    case AGENT_DATA_PART.searchHit: {
      const p = searchHitPartSchema.safeParse(chunk.data);
      return p.success ? { type: 'hit', ...p.data } : undefined;
    }
    case AGENT_DATA_PART.searchLens: {
      const p = searchLensPartSchema.safeParse(chunk.data);
      return p.success ? { type: 'lens', ...p.data } : undefined;
    }
    default:
      return undefined;
  }
}

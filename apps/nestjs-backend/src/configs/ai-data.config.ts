/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import { registerAs } from '@nestjs/config';

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const aiDataConfig = registerAs('aiData', () => ({
  /** Hard cap on records returned by one AI data call. */
  maxRecordsPerCall: toPositiveInt(process.env.AI_DATA_MAX_RECORDS_PER_CALL, 50),
  /** Longest single cell (characters) handed to the model before it is cut. */
  maxCellChars: toPositiveInt(process.env.AI_DATA_MAX_CELL_CHARS, 2000),
  /** Budget for the whole serialized record payload of one call. */
  maxResponseChars: toPositiveInt(process.env.AI_DATA_MAX_RESPONSE_CHARS, 60000),
  /**
   * HMAC key for the signed request context handed to the Mastra service. The internal
   * ai-data endpoint is disabled (404) unless both this and MASTRA_API_KEY are set.
   */
  contextSecret: process.env.AI_DATA_CONTEXT_SECRET || undefined,
  /** Bearer key the Mastra service presents when it calls the internal endpoint. */
  serviceKey: process.env.MASTRA_API_KEY || undefined,
  /** Hard expiry of a context. It is also revoked as soon as the chat turn ends. */
  contextTtlSeconds: toPositiveInt(process.env.AI_DATA_CONTEXT_TTL_SECONDS, 180),
}));

export const AiDataConfig = () => Inject(aiDataConfig.KEY);

export type IAiDataConfig = ReturnType<typeof aiDataConfig>;

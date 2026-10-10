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
}));

export const AiDataConfig = () => Inject(aiDataConfig.KEY);

export type IAiDataConfig = ReturnType<typeof aiDataConfig>;

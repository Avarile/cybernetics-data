import { HttpException } from '@nestjs/common';
import { z } from 'zod';

export interface IAiDataLimits {
  maxRecordsPerCall: number;
  maxCellChars: number;
  maxResponseChars: number;
}

export interface IAiDataRecord {
  id: string;
  fields: Record<string, unknown>;
}

const truncationNote = (total: number) => `… [truncated, ${total} characters in total]`;

/**
 * Cut one cell down to `maxChars`. Strings are sliced; structured values are
 * serialized first, so the model sees a string it can tell is incomplete
 * instead of a half-valid JSON object.
 */
export function capCell(value: unknown, maxChars: number): { value: unknown; truncated: boolean } {
  if (typeof value === 'string') {
    return value.length > maxChars
      ? { value: value.slice(0, maxChars) + truncationNote(value.length), truncated: true }
      : { value, truncated: false };
  }
  if (value === null || typeof value !== 'object') {
    return { value, truncated: false };
  }
  const json = JSON.stringify(value) ?? '';
  return json.length > maxChars
    ? { value: json.slice(0, maxChars) + truncationNote(json.length), truncated: true }
    : { value, truncated: false };
}

/**
 * Apply the per-cell cap to every record, then stop adding records once the
 * serialized payload would pass the response budget. At least one record is
 * always returned so a single large row cannot produce an empty answer.
 */
export function capRecords(
  records: IAiDataRecord[],
  limits: Pick<IAiDataLimits, 'maxCellChars' | 'maxResponseChars'>
): { records: IAiDataRecord[]; truncated: boolean; droppedForSize: number } {
  const out: IAiDataRecord[] = [];
  let truncated = false;
  let size = 0;

  for (let i = 0; i < records.length; i++) {
    const { id, fields } = records[i];
    const cappedFields: Record<string, unknown> = {};
    for (const [key, cell] of Object.entries(fields ?? {})) {
      const capped = capCell(cell, limits.maxCellChars);
      cappedFields[key] = capped.value;
      truncated ||= capped.truncated;
    }
    const record = { id, fields: cappedFields };
    const recordSize = JSON.stringify(record).length;

    if (out.length > 0 && size + recordSize > limits.maxResponseChars) {
      return { records: out, truncated: true, droppedForSize: records.length - i };
    }
    size += recordSize;
    out.push(record);
  }
  return { records: out, truncated, droppedForSize: 0 };
}

/**
 * User-facing text only. HttpException messages are written for users; any
 * other error (driver, Prisma, unexpected throw) can carry query fragments
 * and table names, so it is replaced and the detail goes to the log.
 */
export function toAiDataErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return `Invalid arguments: ${error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')}`;
  }
  if (error instanceof HttpException) {
    return error.message;
  }
  return 'The data lookup failed. Check the server logs for details.';
}

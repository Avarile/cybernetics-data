import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { capCell, capRecords, toAiDataErrorMessage } from './ai-data.limits';

describe('capCell', () => {
  it('passes short strings, numbers, booleans and null through untouched', () => {
    expect(capCell('abc', 10)).toEqual({ value: 'abc', truncated: false });
    expect(capCell(5, 10)).toEqual({ value: 5, truncated: false });
    expect(capCell(false, 10)).toEqual({ value: false, truncated: false });
    expect(capCell(null, 10)).toEqual({ value: null, truncated: false });
  });

  it('cuts long strings and says how long they were', () => {
    const result = capCell('x'.repeat(50), 10);
    expect(result.truncated).toBe(true);
    expect(result.value).toBe(`${'x'.repeat(10)}… [truncated, 50 characters in total]`);
  });

  it('keeps small structured values and turns large ones into a marked string', () => {
    expect(capCell({ a: 1 }, 100)).toEqual({ value: { a: 1 }, truncated: false });
    const big = capCell({ a: 'y'.repeat(100) }, 20);
    expect(big.truncated).toBe(true);
    expect(typeof big.value).toBe('string');
    expect(big.value as string).toContain('truncated');
  });
});

const record = (id: string, text: string) => ({ id, fields: { fldA: text } });

describe('capRecords', () => {
  const limits = { maxCellChars: 1000, maxResponseChars: 1000 };

  it('returns everything and truncated=false when inside the budget', () => {
    const result = capRecords([record('rec1', 'a'), record('rec2', 'b')], limits);
    expect(result.records).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.droppedForSize).toBe(0);
  });

  it('flags truncated when a cell is cut', () => {
    const result = capRecords([record('rec1', 'z'.repeat(50))], { ...limits, maxCellChars: 10 });
    expect(result.truncated).toBe(true);
    expect(result.records).toHaveLength(1);
  });

  it('drops records once the response budget is spent and reports how many', () => {
    const rows = Array.from({ length: 5 }, (_, i) => record(`rec${i}`, 'q'.repeat(100)));
    const result = capRecords(rows, { maxCellChars: 1000, maxResponseChars: 300 });
    expect(result.truncated).toBe(true);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.length).toBeLessThan(5);
    expect(result.records.length + result.droppedForSize).toBe(5);
  });

  it('always returns at least one record, even if it alone exceeds the budget', () => {
    const result = capRecords([record('rec1', 'w'.repeat(500))], {
      maxCellChars: 1000,
      maxResponseChars: 10,
    });
    expect(result.records).toHaveLength(1);
  });

  it('handles records with no fields', () => {
    const result = capRecords([{ id: 'rec1', fields: undefined as never }], limits);
    expect(result.records).toEqual([{ id: 'rec1', fields: {} }]);
  });
});

describe('toAiDataErrorMessage', () => {
  it('passes HttpException messages through', () => {
    expect(toAiDataErrorMessage(new ForbiddenException('no access'))).toBe('no access');
  });

  it('summarises validation errors', () => {
    const parsed = z.object({ tableId: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(toAiDataErrorMessage(parsed.error)).toContain('tableId');
    }
  });

  it('hides driver and unknown errors', () => {
    const message = toAiDataErrorMessage(new Error('select * from "bseX"."tblY" failed'));
    expect(message).not.toContain('bseX');
    expect(message).toContain('failed');
  });
});

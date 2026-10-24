import { describe, expect, it } from 'vitest';
import { CoordinateManager } from '../managers';
import { getRegionPosition } from './region';

// Row header 40px, one frozen 100px column, so the freeze region ends at x = 140
const coordInstance = new CoordinateManager({
  rowCount: 20,
  pureRowCount: 20,
  columnCount: 10,
  containerWidth: 500,
  containerHeight: 500,
  rowHeight: 30,
  columnWidth: 100,
  rowInitSize: 40,
  columnInitSize: 40,
  freezeColumnCount: 1,
});

describe('getRegionPosition', () => {
  const scrolled = { scrollLeft: 300, scrollTop: 0 };

  it('keeps the frozen column under the pointer after a horizontal scroll', () => {
    expect(getRegionPosition(coordInstance, scrolled, 100, 50).columnIndex).toBe(0);
  });

  it('adds the horizontal scroll outside the freeze region', () => {
    // 300 + 200 = 500 → column 4 (40 + 4 * 100 = 440)
    expect(getRegionPosition(coordInstance, scrolled, 200, 50).columnIndex).toBe(4);
  });

  it('reports the row header and the column header', () => {
    expect(getRegionPosition(coordInstance, scrolled, 20, 50).columnIndex).toBe(-1);
    expect(getRegionPosition(coordInstance, scrolled, 200, 20).rowIndex).toBe(-1);
  });

  it('resolves rows with the vertical scroll', () => {
    // 60 + 50 = 110 → row 2 (40 + 2 * 30 = 100)
    expect(getRegionPosition(coordInstance, { scrollLeft: 0, scrollTop: 60 }, 200, 50)).toEqual({
      x: 200,
      y: 50,
      rowIndex: 2,
      columnIndex: 1,
    });
  });
});

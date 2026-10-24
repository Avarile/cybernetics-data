import { describe, expect, it } from 'vitest';
import type { IGridTheme } from '../../configs';
import { booleanCellRenderer } from './booleanCellRenderer';
import type { IBooleanCell, ICellClickProps } from './interface';
import { CellRegionType, CellType } from './interface';

const theme = { iconSizeSM: 20 } as IGridTheme;

const checkAt = (contentAlign: IBooleanCell['contentAlign'], x: number) => {
  const cell: IBooleanCell = { type: CellType.Boolean, data: false, contentAlign };
  const props = {
    width: 200,
    height: 32,
    theme,
    isActive: false,
    activeCellBound: null,
    hoverCellPosition: [x, 16],
  } as ICellClickProps;
  return booleanCellRenderer.checkRegion?.(cell, props, true)?.type;
};

describe('booleanCellRenderer.checkRegion', () => {
  it('hits the checkbox where draw puts it for each alignment', () => {
    // padding 8, icon 20: left 8-28, centre 90-110, right 172-192
    expect(checkAt('left', 15)).toBe(CellRegionType.Update);
    expect(checkAt('center', 100)).toBe(CellRegionType.Update);
    expect(checkAt('right', 185)).toBe(CellRegionType.Update);
  });

  it('ignores the cell centre when the checkbox is aligned to a side', () => {
    expect(checkAt('left', 100)).toBe(CellRegionType.Blank);
    expect(checkAt('right', 100)).toBe(CellRegionType.Blank);
  });
});

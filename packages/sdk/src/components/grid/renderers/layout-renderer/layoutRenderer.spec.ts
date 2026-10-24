import { describe, expect, it } from 'vitest';
import { RegionType, RowControlType } from '../../interface';
import type { IMouseState } from '../../interface';
import type { ILayoutDrawerProps } from './interface';
import {
  computeShouldRerender,
  getCommentCountOffsetX,
  getHoveredRowIndex,
} from './layoutRenderer';

const mouseAt = (rowIndex: number, overrides: Partial<IMouseState> = {}): IMouseState => ({
  x: 0,
  y: 0,
  rowIndex,
  columnIndex: 0,
  type: RegionType.Cell,
  isOutOfBounds: false,
  ...overrides,
});

// Only the fields computeShouldRerender compares; the shared ones keep the same identity.
const shared = {
  theme: {},
  columns: [],
  getLinearRow: () => undefined,
  real2RowIndex: () => 0,
  getCellContent: () => undefined,
  coordInstance: {},
  visibleRegion: {},
  forceRenderFlag: 'flag',
  hoverCellPosition: null,
};

const makeProps = (mouseState: IMouseState, isSelecting = false) =>
  ({ ...shared, mouseState, isSelecting }) as unknown as ILayoutDrawerProps;

describe('getHoveredRowIndex', () => {
  it('returns the hovered row inside row regions', () => {
    expect(getHoveredRowIndex(makeProps(mouseAt(3)))).toBe(3);
    expect(getHoveredRowIndex(makeProps(mouseAt(3, { type: RegionType.RowHeader })))).toBe(3);
  });

  it('returns -1 outside row regions, out of bounds or while selecting', () => {
    expect(getHoveredRowIndex(makeProps(mouseAt(3, { type: RegionType.ColumnHeader })))).toBe(-1);
    expect(getHoveredRowIndex(makeProps(mouseAt(3, { isOutOfBounds: true })))).toBe(-1);
    expect(getHoveredRowIndex(makeProps(mouseAt(3), true))).toBe(-1);
  });
});

describe('computeShouldRerender', () => {
  it('rerenders the cache when the hovered row changes', () => {
    expect(computeShouldRerender(makeProps(mouseAt(4)), makeProps(mouseAt(3)))).toBe(true);
  });

  it('keeps the cache while the mouse moves within the same row', () => {
    const last = makeProps(mouseAt(3, { columnIndex: 0 }));
    const current = makeProps(mouseAt(3, { columnIndex: 5, x: 200 }));

    expect(computeShouldRerender(current, last)).toBe(false);
  });
});

describe('getCommentCountOffsetX', () => {
  it('centres the badge on the Expand control slot', () => {
    const rowControls = [
      { type: RowControlType.Drag },
      { type: RowControlType.Checkbox },
      { type: RowControlType.Expand },
    ];
    expect(getCommentCountOffsetX(90, rowControls)).toBe(75);
  });

  it('stays inside the row header when Expand is the second of two controls', () => {
    const rowControls = [{ type: RowControlType.Checkbox }, { type: RowControlType.Expand }];
    expect(getCommentCountOffsetX(64, rowControls)).toBe(48);
  });

  it('has no slot without an Expand control', () => {
    expect(getCommentCountOffsetX(64, [{ type: RowControlType.Checkbox }])).toBeNull();
  });
});

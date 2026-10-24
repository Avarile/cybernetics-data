import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ILinearRow } from './interface';
import { LinearRowType } from './interface';
import { CoordinateManager } from './managers';
import { CellType } from './renderers';
import type { ITouchLayerProps } from './TouchLayer';
import { TouchLayer } from './TouchLayer';

const hammer = vi.hoisted(() => ({ onTap: null as ((e: unknown) => void) | null }));

vi.mock('react-hammerjs', () => ({
  default: (props: { onTap: (e: unknown) => void; children: ReactNode }) => {
    hammer.onTap = props.onTap;
    return props.children;
  },
}));

vi.mock('./RenderLayer', () => ({ RenderLayer: () => null }));

// 0 group A, 1-2 records 0-1, 3 append of A, 4 group B, 5 record 2, 6 append of B
const linearRows: ILinearRow[] = [
  { type: LinearRowType.Group, id: 'a', depth: 0, value: 'A', realIndex: 0, isCollapsed: false },
  { type: LinearRowType.Row, displayIndex: 1, realIndex: 0 },
  { type: LinearRowType.Row, displayIndex: 2, realIndex: 1 },
  { type: LinearRowType.Append, value: 'A', realIndex: 1 },
  { type: LinearRowType.Group, id: 'b', depth: 0, value: 'B', realIndex: 2, isCollapsed: false },
  { type: LinearRowType.Row, displayIndex: 1, realIndex: 2 },
  { type: LinearRowType.Append, value: 'B', realIndex: 2 },
];

// Column header 40px high, row header 60px wide, every row 30px high
const coordInstance = new CoordinateManager({
  rowCount: linearRows.length,
  pureRowCount: 3,
  columnCount: 3,
  containerWidth: 500,
  containerHeight: 500,
  rowHeight: 30,
  columnWidth: 100,
  rowInitSize: 40,
  columnInitSize: 60,
});

const renderTouchLayer = () => {
  const props = {
    width: 500,
    height: 500,
    theme: {},
    columns: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    coordInstance,
    scrollState: { scrollTop: 0, scrollLeft: 0, isScrolling: false },
    mouseState: {},
    rowControls: [],
    forceRenderFlag: 'flag',
    getLinearRow: (index: number) => linearRows[index],
    real2RowIndex: (index: number) => ({ 0: 1, 1: 2, 2: 5 })[index],
    getCellContent: vi.fn(() => ({ type: CellType.Text, data: '', displayData: '' })),
    setActiveCell: vi.fn(),
    setMouseState: vi.fn(),
    onRowAppend: vi.fn(),
    onRowExpand: vi.fn(),
    onCollapsedGroupChanged: vi.fn(),
  };
  render(<TouchLayer {...(props as unknown as ITouchLayerProps)} />);
  return props;
};

// Tap at x inside the given linear row
const tap = (x: number, linearRowIndex: number) => {
  const y = coordInstance.getRowOffset(linearRowIndex) + 15;
  act(() => hammer.onTap?.({ changedPointers: [{ offsetX: x, offsetY: y }] }));
};

describe('TouchLayer in a grouped view', () => {
  it('uses the real record index for a tapped cell', () => {
    const props = renderTouchLayer();

    tap(150, 5);

    expect(props.getCellContent).toHaveBeenCalledWith([0, 2]);
    expect(props.setActiveCell).toHaveBeenCalledWith([0, 2]);
    expect(props.onRowExpand).toHaveBeenCalledWith(2);
  });

  it('does not expand a record when the group header body is tapped', () => {
    const props = renderTouchLayer();

    tap(150, 4);

    expect(props.onRowExpand).not.toHaveBeenCalled();
    expect(props.onCollapsedGroupChanged).not.toHaveBeenCalled();
  });

  it('toggles the group from the whole row header width', () => {
    const props = renderTouchLayer();

    // x = 50 is past rowInitSize (40) but still inside the row header (60)
    tap(50, 4);

    expect(props.onCollapsedGroupChanged).toHaveBeenCalledWith(new Set(['b']));
    expect(props.onRowExpand).not.toHaveBeenCalled();
  });

  it('appends into the tapped group, not only on the last append row', () => {
    const props = renderTouchLayer();

    tap(150, 3);

    expect(props.onRowAppend).toHaveBeenCalledWith(1);
    expect(props.onRowExpand).not.toHaveBeenCalled();
  });
});

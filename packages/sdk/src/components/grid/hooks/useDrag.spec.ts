import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ILinearRow, IMouseState, IRange } from '../interface';
import {
  DragRegionType,
  DraggableType,
  LinearRowType,
  RegionType,
  SelectionRegionType,
} from '../interface';
import { CombinedSelection, CoordinateManager } from '../managers';
import { useDrag } from './useDrag';

// Grouped view: linear 0 group A, 1-2 records 0-1, 3 group B, 4-5 records 2-3
const linearRows: ILinearRow[] = [
  { type: LinearRowType.Group, id: 'a', depth: 0, value: 'A', realIndex: 0, isCollapsed: false },
  { type: LinearRowType.Row, displayIndex: 1, realIndex: 0 },
  { type: LinearRowType.Row, displayIndex: 2, realIndex: 1 },
  { type: LinearRowType.Group, id: 'b', depth: 0, value: 'B', realIndex: 2, isCollapsed: false },
  { type: LinearRowType.Row, displayIndex: 1, realIndex: 2 },
  { type: LinearRowType.Row, displayIndex: 2, realIndex: 3 },
];
const real2LinearRowMap: Record<number, number> = { 0: 1, 1: 2, 2: 4, 3: 5 };
const getLinearRow = (index: number) => linearRows[index];
const real2RowIndex = (index: number) => real2LinearRowMap[index];

const coordInstance = new CoordinateManager({
  rowCount: linearRows.length,
  pureRowCount: 4,
  columnCount: 3,
  containerWidth: 500,
  containerHeight: 500,
  rowHeight: 30,
  columnWidth: 100,
  rowInitSize: 40,
  columnInitSize: 40,
  freezeColumnCount: 1,
});
const scrollState = { scrollTop: 0, scrollLeft: 0, isScrolling: false };

const mouseAtRow = (rowIndex: number, type = RegionType.RowHeaderDragHandler): IMouseState => ({
  x: 10,
  // vertical middle of the linear row
  y: coordInstance.getRowOffset(rowIndex) + 15,
  rowIndex,
  columnIndex: -1,
  type,
  isOutOfBounds: false,
});

const renderDrag = (selection: CombinedSelection) =>
  renderHook(() =>
    useDrag(coordInstance, scrollState, selection, getLinearRow, real2RowIndex, DraggableType.All)
  );

describe('useDrag row dragging in a grouped view', () => {
  it('drags the whole row selection when the hovered record is selected', () => {
    // records 2-3 (group B) are selected, drag starts from record 3 (linear 5)
    const selection = new CombinedSelection(SelectionRegionType.Rows, [[2, 3]]);
    const { result } = renderDrag(selection);
    const onStart = vi.fn();

    act(() => result.current.onDragStart(mouseAtRow(5), onStart));

    expect(onStart).toHaveBeenCalledWith(DragRegionType.Rows, [[2, 3]]);
    expect(result.current.dragState.ranges).toEqual([[2, 3]]);
  });

  it('drags only the hovered record (as a real index) when it is not selected', () => {
    const selection = new CombinedSelection(SelectionRegionType.Rows, [[0, 0]]);
    const { result } = renderDrag(selection);
    const onStart = vi.fn();

    // linear 2 is record 1
    act(() => result.current.onDragStart(mouseAtRow(2), onStart));

    expect(onStart).toHaveBeenCalledWith(DragRegionType.Rows, [[1, 1]] as IRange[]);
  });

  it('reports real dragged indices on drop and skips drops onto the dragged rows', () => {
    const selection = new CombinedSelection(SelectionRegionType.Rows, [[2, 2]]);
    const { result } = renderDrag(selection);

    act(() => result.current.onDragStart(mouseAtRow(4), vi.fn()));
    act(() => result.current.onDragChange({ ...mouseAtRow(1), y: 0 }));

    // dropping onto the dragged record itself (linear 4) is a no-op
    const onNoop = vi.fn();
    act(() => result.current.onDragEnd(mouseAtRow(4), onNoop));
    expect(onNoop).not.toHaveBeenCalled();

    act(() => result.current.onDragStart(mouseAtRow(4), vi.fn()));
    act(() => result.current.onDragChange({ ...mouseAtRow(1), y: 0 }));
    const onEnd = vi.fn();
    // upper half of linear 1 → drop index is linear 1
    act(() =>
      result.current.onDragEnd({ ...mouseAtRow(1), y: coordInstance.getRowOffset(1) + 5 }, onEnd)
    );
    expect(onEnd).toHaveBeenCalledWith([[2, 2]], 1);
  });
});

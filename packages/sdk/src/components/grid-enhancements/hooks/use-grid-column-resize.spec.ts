import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import type { IGridColumn } from '../../grid/interface';
import { useGridColumnResize } from './use-grid-column-resize';

const { updateColumnMeta } = vi.hoisted(() => ({ updateColumnMeta: vi.fn() }));
const fields = [{ id: 'fldA' }, { id: 'fldB' }];

vi.mock('../../../hooks', () => ({ useView: () => ({ updateColumnMeta }) }));
vi.mock('../../../hooks/use-fields', () => ({ useFields: () => fields }));
vi.mock('../../../hooks/use-view-id', () => ({ useViewId: () => 'viwTest' }));

describe('useGridColumnResize', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateColumnMeta.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves every column resized within the debounce window', () => {
    const columns = fields.map(({ id }) => ({ id, name: id, width: 100 }));
    const { result } = renderHook(() => useGridColumnResize(columns));

    act(() => result.current.onColumnResize(columns[0] as IGridColumn, 150, 0));
    act(() => result.current.onColumnResize(columns[1] as IGridColumn, 220, 1));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(updateColumnMeta).toHaveBeenCalledTimes(1);
    expect(updateColumnMeta).toHaveBeenCalledWith([
      { fieldId: 'fldA', columnMeta: { width: 150 } },
      { fieldId: 'fldB', columnMeta: { width: 220 } },
    ]);
  });
});

import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import type { Record as IRecordInstance } from '../../../model';
import type { IRecordIndexMap } from './use-grid-async-records';
import { useGridRowOrder } from './use-grid-row-order';

const { updateRecords } = vi.hoisted(() => ({ updateRecords: vi.fn() }));

vi.mock('../../../hooks', () => ({
  useTableId: () => 'tblTest',
  useViewId: () => 'viwTest',
  useView: () => ({ group: [{ fieldId: 'fldGroup', order: 'asc' }] }),
  useRecordOperations: () => ({ updateRecords }),
}));

const record = (id: string, group: string) =>
  ({ id, getCellValue: () => group }) as unknown as IRecordInstance;

describe('useGridRowOrder', () => {
  it('dropping at the top takes the group values of the first record', () => {
    // groups A: [r0], B: [r1, r2]
    const recordMap: IRecordIndexMap = {
      0: record('r0', 'A'),
      1: record('r1', 'B'),
      2: record('r2', 'B'),
    };
    const { result } = renderHook(() => useGridRowOrder(recordMap));

    act(() => result.current.setDraggingRecordIds(['r2']));
    act(() => {
      result.current.onRowOrdered([2], 0);
    });

    expect(updateRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        recordsRo: expect.objectContaining({
          records: [{ id: 'r2', fields: { fldGroup: 'A' } }],
          order: { viewId: 'viwTest', anchorId: 'r0', position: 'before' },
        }),
      })
    );
  });
});

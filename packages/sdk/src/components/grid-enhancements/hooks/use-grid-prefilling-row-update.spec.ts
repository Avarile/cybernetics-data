import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useGridPrefillingRow } from './use-grid-prefilling-row';

vi.mock('../../../hooks', () => ({
  useView: () => undefined,
  useBaseId: () => 'bseTest',
  useTableId: () => 'tblTest',
  useFields: () => [],
  useSession: () => ({ user: { id: 'usrTest' } }),
}));
vi.mock('./use-grid-columns', () => ({
  useCreateCellValue2GridDisplay: () => () => () => ({}),
}));

describe('useGridPrefillingRow updateCell', () => {
  it('keeps every field when several cells are edited before a re-render', () => {
    const { result } = renderHook(() => useGridPrefillingRow([]));

    act(() => result.current.setPrefillingFieldValueMap({}));
    act(() => {
      // e.g. a multi-cell paste updates several fields synchronously
      result.current.localRecord?.updateCell('fldA', 'a');
      result.current.localRecord?.updateCell('fldB', 'b');
    });

    expect(result.current.prefillingFieldValueMap).toEqual({ fldA: 'a', fldB: 'b' });
  });
});

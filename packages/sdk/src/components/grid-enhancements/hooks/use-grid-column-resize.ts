import { useCallback, useState, useEffect, useRef } from 'react';
import { useDebounce } from 'react-use';
import type { IGridColumn } from '../..';
import { useView } from '../../../hooks';
import { useFields } from '../../../hooks/use-fields';
import { useViewId } from '../../../hooks/use-view-id';

export function useGridColumnResize<T extends { id: string }>(_columns: T[]) {
  const fields = useFields();
  const view = useView();
  const viewId = useViewId();
  // widths waiting for the debounced save, keyed by field id so resizing several columns keeps them all
  const pendingWidthsRef = useRef<Record<string, number>>({});
  const [resizeCount, setResizeCount] = useState(0);
  const [columns, setColumns] = useState(_columns);

  useEffect(() => setColumns(_columns), [_columns]);

  useDebounce(
    () => {
      if (!view) {
        return;
      }

      const pendingWidths = pendingWidthsRef.current;
      const fieldIds = Object.keys(pendingWidths);
      if (!fieldIds.length) {
        return;
      }
      pendingWidthsRef.current = {};
      view.updateColumnMeta(
        fieldIds.map((fieldId) => ({
          fieldId,
          columnMeta: { width: pendingWidths[fieldId] },
        }))
      );
    },
    300,
    [resizeCount]
  );

  const onColumnResize = useCallback(
    (column: IGridColumn, newSize: number, colIndex: number) => {
      const fieldId = column.id;
      const field = fields[colIndex];
      if (!field) {
        throw new Error('Can not find field by id: ' + fieldId);
      }

      if (field.id !== column.id) {
        throw new Error('field id not match column id');
      }

      if (!viewId) {
        throw new Error('Can not find view id');
      }

      const index = columns.findIndex((ci) => ci.id === column.id);
      const newColumns = [...columns];
      const newColumn = {
        ...columns[index],
        width: newSize,
      };
      newColumns.splice(index, 1, newColumn);

      setColumns(newColumns);
      pendingWidthsRef.current[field.id] = newSize;
      setResizeCount((count) => count + 1);
    },
    [columns, fields, setColumns, viewId]
  );

  return { columns, onColumnResize };
}

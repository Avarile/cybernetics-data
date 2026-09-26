import { ExpandRecorder } from '@teable/sdk/components';
import { AnchorContext, TablePermissionProvider } from '@teable/sdk/context';

interface IRecordEditorProps {
  baseId: string;
  tableId: string;
  recordId: string;
  onClose: () => void;
}

/**
 * The grid's record editor, opened from the graph. The graph page has no
 * current table, so the anchor is re-pointed at the record's table: that is
 * what the editor's table and permission hooks resolve against.
 */
export const RecordEditor = ({ baseId, tableId, recordId, onClose }: IRecordEditorProps) => (
  <AnchorContext.Provider value={{ baseId, tableId }}>
    <TablePermissionProvider baseId={baseId}>
      <ExpandRecorder
        tableId={tableId}
        recordId={recordId}
        recordIds={[recordId]}
        onClose={onClose}
      />
    </TablePermissionProvider>
  </AnchorContext.Provider>
);

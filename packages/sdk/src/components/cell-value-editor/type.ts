import type { IAttachmentCellValue } from '@cybernetics/core';
import type { IButtonClickStatusHook } from '../../hooks';
import type { Field, Record } from '../../model';
import type { ICellEditor } from '../editor/type';

export interface ICellValueEditor<T = unknown> extends Omit<ICellEditor<T>, 'value'> {
  wrapClassName?: string;
  wrapStyle?: React.CSSProperties;
  cellValue?: T;
  field: Field;
  recordId?: string;
  buttonClickStatusHook?: IButtonClickStatusHook;
  record?: Record;
  hideExpand?: boolean;
  /** Larger layout of the expanded record modal: long text editors get double height */
  expanded?: boolean;
  onAttachmentDownload?: (attachments: IAttachmentCellValue) => void;
}

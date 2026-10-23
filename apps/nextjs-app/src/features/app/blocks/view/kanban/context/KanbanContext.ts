import type { AttachmentField, IFieldInstance } from '@cybernetics/sdk/model';
import type { IGetRecordsRo } from '@teable/openapi';
import type { Dispatch, SetStateAction } from 'react';
import { createContext } from 'react';
import type { IKanbanPermission, IStackData } from '../type';

export interface IKanbanContext {
  recordQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy'>;
  stackField?: IFieldInstance;
  stackCollection?: IStackData[];
  coverField?: AttachmentField;
  isCoverFit?: boolean;
  isFieldNameHidden?: boolean;
  isEmptyStackHidden?: boolean;
  permission: IKanbanPermission;
  primaryField: IFieldInstance;
  displayFields: IFieldInstance[];
  setExpandRecordId: Dispatch<SetStateAction<string | undefined>>;
}

export const KanbanContext = createContext<IKanbanContext>(null!);

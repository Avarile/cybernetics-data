import type { IColorConfig } from '@cybernetics/core';
import type { DateField, IFieldInstance, SingleSelectField } from '@cybernetics/sdk/model';
import type { IGetRecordsRo } from '@teable/openapi';
import type { Dispatch, SetStateAction } from 'react';
import { createContext } from 'react';
import type { ICalendarPermission } from '../type';

export interface ICalendarContext {
  recordQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy'>;
  titleField?: IFieldInstance;
  startDateField?: DateField;
  endDateField?: DateField;
  colorField?: SingleSelectField;
  colorConfig?: IColorConfig;
  permission: ICalendarPermission;
  setExpandRecordId: Dispatch<SetStateAction<string | undefined>>;
}

export const CalendarContext = createContext<ICalendarContext>(null!);

import type { IDatetimeFormatting } from '@cybernetics/core';
import { formatDateToString } from '@cybernetics/core';
import { omit } from 'lodash';

export const cellDate2String = (
  cellValue: unknown,
  formatting: IDatetimeFormatting,
  isMultipleCellValue: boolean | undefined
) => {
  if (cellValue == null) return '';
  if (isMultipleCellValue && Array.isArray(cellValue)) {
    return cellValue
      .map((v) =>
        formatDateToString(v as string, omit(formatting, 'timeZone') as IDatetimeFormatting)
      )
      .join(', ');
  }

  return formatDateToString(
    cellValue as string,
    omit(formatting, 'timeZone') as IDatetimeFormatting
  );
};

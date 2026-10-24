import { DateFormattingPreset, formatDateToString } from '@cybernetics/core';
import type { IDatetimeFormatting } from '@cybernetics/core';
import { cn } from '@teable/ui-lib';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { OverflowTooltip } from '../components';
import type { ICellValue } from '../type';

interface ICellDate extends ICellValue<string | string[]> {
  formatting?: IDatetimeFormatting | null;
}

export const CellDate = (props: ICellDate) => {
  const { value, formatting, ellipsis, className, style } = props;

  const displayValue = useMemo(() => {
    if (value == null) return '';
    const format = (v: string) =>
      formatting == null
        ? dayjs(v).format(DateFormattingPreset.ISO)
        : formatDateToString(v, formatting);

    if (Array.isArray(value)) {
      return value
        .filter((v) => v != null)
        .map(format)
        .join(', ');
    }
    return format(value);
  }, [value, formatting]);

  return (
    <OverflowTooltip
      text={displayValue}
      ellipsis={ellipsis}
      className={cn('w-full text-[13px] leading-5', className)}
      style={style}
    />
  );
};

import type { IDatetimeFormatting } from '@cybernetics/core';
import { formatDateToString, normalizeDateFormatting, TimeFormatting } from '@cybernetics/core';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import dayjs from 'dayjs';

/**
 * Combine the calendar day of `day` with the time of day of `timeSource` (now when absent),
 * both read in `timeZone`, and return the UTC ISO string. Reading both parts in the field
 * timezone keeps the result independent of the browser timezone.
 */
export const combineZonedDateAndTime = (
  day: Date,
  timeSource: string | Date | null | undefined,
  timeZone: string
) => {
  const datePart = formatInTimeZone(day, timeZone, 'yyyy-MM-dd');
  const timePart = formatInTimeZone(timeSource ?? new Date(), timeZone, 'HH:mm:ss');
  return fromZonedTime(`${datePart}T${timePart}`, timeZone).toISOString();
};

export const formatDisplayValue = (value: string, formatting: IDatetimeFormatting) => {
  const normalizedFormatting = {
    ...formatting,
    date: normalizeDateFormatting(formatting.date),
  };
  return dayjs(value).isValid() ? formatDateToString(value, normalizedFormatting) : '';
};

export const convertZonedInputToUtc = (inputValue: string, formatting: IDatetimeFormatting) => {
  const { date: dateFormatting, time: timeFormatting, timeZone } = formatting;
  const isTimeNone = timeFormatting === TimeFormatting.None;
  const normalizedDateFormatting = normalizeDateFormatting(dateFormatting);
  const formats = isTimeNone
    ? [normalizedDateFormatting]
    : [`${normalizedDateFormatting} ${timeFormatting}`, normalizedDateFormatting];
  let curDate = dayjs(inputValue.trim(), formats);
  const isValid = curDate.isValid();

  if (!isValid) return null;

  if (isTimeNone) {
    // Wall-clock time in the field timezone, so the hours below are field-local
    const now = toZonedTime(new Date(), timeZone);
    curDate = curDate
      .set('hour', now.getHours())
      .set('minute', now.getMinutes())
      .set('second', now.getSeconds());
  }

  const zonedDate = curDate.toDate();
  const utcDate = fromZonedTime(zonedDate, timeZone);

  return utcDate.toISOString();
};

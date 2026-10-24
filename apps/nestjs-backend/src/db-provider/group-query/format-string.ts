import { DateFormattingPreset, TimeFormatting } from '@cybernetics/core';

export const getPostgresDateTimeFormatString = (
  date: DateFormattingPreset,
  time: TimeFormatting
) => {
  switch (date) {
    case DateFormattingPreset.Y:
      return 'YYYY';
    case DateFormattingPreset.M:
    case DateFormattingPreset.YM:
      return 'YYYY-MM';
    default:
      return time !== TimeFormatting.None ? 'YYYY-MM-DD HH24:MI' : 'YYYY-MM-DD';
  }
};

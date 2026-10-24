import type { IShareViewMeta } from '@cybernetics/core';
import { CalendarViewCore } from '@cybernetics/core';

export class CalendarViewDto extends CalendarViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}

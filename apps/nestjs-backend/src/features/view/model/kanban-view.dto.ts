import type { IShareViewMeta } from '@cybernetics/core';
import { KanbanViewCore } from '@cybernetics/core';

export class KanbanViewDto extends KanbanViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}

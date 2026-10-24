import type { IShareViewMeta } from '@cybernetics/core';
import { GridViewCore } from '@cybernetics/core';

export class GridViewDto extends GridViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}

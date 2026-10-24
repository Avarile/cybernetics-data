import type { IShareViewMeta } from '@cybernetics/core';
import { PluginViewCore } from '@cybernetics/core';

export class PluginViewDto extends PluginViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}

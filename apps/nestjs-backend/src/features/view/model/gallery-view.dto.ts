import type { IShareViewMeta } from '@cybernetics/core';
import { GalleryViewCore } from '@cybernetics/core';

export class GalleryViewDto extends GalleryViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}

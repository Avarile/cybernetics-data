import { ViewType } from '@cybernetics/core';
import type { IShareViewMeta } from '@cybernetics/core';

export const VIEW_DEFAULT_SHARE_META: {
  viewType: ViewType;
  defaultShareMeta?: IShareViewMeta;
}[] = [
  {
    viewType: ViewType.Form,
    defaultShareMeta: {
      submit: {
        allow: true,
      },
    },
  },
  {
    viewType: ViewType.Kanban,
    defaultShareMeta: {
      includeRecords: true,
    },
  },
  {
    viewType: ViewType.Gallery,
    defaultShareMeta: {
      includeRecords: true,
    },
  },
  {
    viewType: ViewType.Grid,
    defaultShareMeta: {
      includeRecords: true,
    },
  },
];

import type { IShareViewMeta } from '@cybernetics/core';
import { FormViewCore } from '@cybernetics/core';

export class FormViewDto extends FormViewCore {
  defaultShareMeta: IShareViewMeta = {
    submit: {
      allow: true,
    },
  };
}

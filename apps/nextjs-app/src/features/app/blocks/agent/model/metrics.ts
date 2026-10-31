import type { ISearchTone } from '@teable/openapi';

/** One total of the readout: label, value, an optional note, and its tone (the cockpit's kpi). */
export interface IMetric {
  k: string;
  v: number | string;
  s?: string;
  tone: ISearchTone;
}

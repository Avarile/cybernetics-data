import type {
  IClarifyPart,
  ISearchHitPart,
  ISearchLensPart,
  ISearchPlanPart,
  ISearchStepPart,
} from '@teable/openapi';
import { AGENT_DATA_PART } from '@teable/openapi';
import type { ISearchEventSink } from '../../domain/ports';

/** The bit of the AI SDK UI stream writer the sink uses. */
export interface IDataPartWriter {
  write(chunk: { type: `data-${string}`; id?: string; data: unknown; transient?: boolean }): void;
}

/**
 * Search progress into the turn's UI message stream (cockpit design §7.2). Tools get the sink
 * before the stream exists; it buffers until `attach` hands it the writer. Plans, lenses and
 * clarify cards are kept in the message (same id replaces); steps and hits are transient.
 */
export class DeferredUiSink implements ISearchEventSink {
  private writer?: IDataPartWriter;
  private readonly pending: Parameters<IDataPartWriter['write']>[0][] = [];

  attach(writer: IDataPartWriter) {
    this.writer = writer;
    for (const chunk of this.pending.splice(0)) writer.write(chunk);
  }

  private write(chunk: Parameters<IDataPartWriter['write']>[0]) {
    if (this.writer) this.writer.write(chunk);
    else this.pending.push(chunk);
  }

  plan(part: ISearchPlanPart) {
    this.write({ type: AGENT_DATA_PART.searchPlan, id: part.searchId, data: part });
  }

  step(part: ISearchStepPart) {
    this.write({
      type: AGENT_DATA_PART.searchStep,
      id: `${part.searchId}:${part.state.stepId}`,
      data: part,
      transient: true,
    });
  }

  hit(part: ISearchHitPart) {
    this.write({
      type: AGENT_DATA_PART.searchHit,
      id: `${part.searchId}:${part.card.key}`,
      data: part,
      transient: true,
    });
  }

  lens(part: ISearchLensPart) {
    this.write({ type: AGENT_DATA_PART.searchLens, id: part.searchId, data: part });
  }

  clarify(part: IClarifyPart) {
    this.write({ type: AGENT_DATA_PART.clarify, id: part.clarifyId, data: part });
  }
}

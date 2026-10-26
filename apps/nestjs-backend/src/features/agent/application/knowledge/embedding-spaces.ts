import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { embedMany } from 'ai';
import { Queue } from 'bullmq';
import {
  AGENT_STORE_PORT,
  MODEL_PORT,
  RAG_STORE_PORT,
  type IAgentStorePort,
  type IModelPort,
  type IRagSpace,
  type IRagStorePort,
} from '../../domain/ports';
import { RAG_JOBS_QUEUE, type IRagJobData } from './rag-jobs';

/** Texts per embedding request (design §11.3). */
export const EMBED_BATCH = 100;
/** A retired space's table is dropped this long after it was retired (design §11.5). */
export const RETIRED_SPACE_DAYS = 7;
const dayMs = 86_400_000;
const backfillOptions = { attempts: 5, backoff: { type: 'exponential' as const, delay: 5000 } };

/**
 * Embedding spaces (design §11.1, §11.5): one per embedding model. New chunks are written to the
 * active space and to any space being built. A model without a space gets one in `building`
 * state and a backfill job; the backfill makes it active when every chunk has a vector.
 */
@Injectable()
export class EmbeddingSpaces {
  private readonly logger = new Logger(EmbeddingSpaces.name);

  constructor(
    @Inject(RAG_STORE_PORT) private readonly rag: IRagStorePort,
    @Inject(MODEL_PORT) private readonly models: IModelPort,
    @Inject(AGENT_STORE_PORT) private readonly store: IAgentStorePort,
    @InjectQueue(RAG_JOBS_QUEUE) private readonly queue: Queue<IRagJobData>
  ) {}

  /** agent_setup.embedding_model of the default setup; null means keyword search only. */
  async configuredModel(): Promise<string | null> {
    return (await this.store.getDefaultProfile())?.embeddingModel ?? null;
  }

  async embed(ref: string, texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const { model } = await this.models.embedder(ref);
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const { embeddings } = await embedMany({ model, values: texts.slice(i, i + EMBED_BATCH) });
      out.push(...embeddings);
    }
    return out;
  }

  /** The spaces that new chunks go to; starts building the configured model's space if needed. */
  async targets(actorUserId: string): Promise<IRagSpace[]> {
    const ref = await this.configuredModel();
    // the active space, and the space being built for the configured model (not stale builds)
    const live = (await this.rag.listSpaces()).filter(
      (s) => s.status === 'active' || (s.status === 'building' && s.model === ref)
    );
    if (!ref || live.some((s) => s.model === ref)) return live;
    return [...live, await this.build(ref, actorUserId)];
  }

  /** Create the space of a model (probing its dimension) and queue its backfill. */
  async build(ref: string, actorUserId: string): Promise<IRagSpace> {
    const [probe] = await this.embed(ref, ['dimension probe']);
    const space = await this.rag.ensureSpace(ref, probe.length, 'building');
    if (space.status === 'building') {
      await this.queue.add('backfill', { space: space.slug, actorUserId }, backfillOptions);
      this.logger.log(`embedding space ${space.slug} is building`);
    }
    return space;
  }

  /** Embed every chunk the space is missing, in batches, then make it active. Resumable. */
  async backfill(slug: string): Promise<{ embedded: number; activated: boolean }> {
    const space = (await this.rag.listSpaces()).find((s) => s.slug === slug);
    if (!space || space.status !== 'building') return { embedded: 0, activated: false };
    let embedded = await this.fill(slug, space.model);
    // only the configured model becomes active; a space for a model replaced meanwhile stays built
    const activated = (await this.configuredModel()) === space.model;
    if (activated) {
      await this.rag.activateSpace(slug);
      // ingests that started before the space existed wrote to the old spaces only
      embedded += await this.fill(slug, space.model);
      await this.cleanup();
    }
    return { embedded, activated };
  }

  /** Setup changed: start building the configured model's space, drop old retired spaces. */
  async ensure(actorUserId: string) {
    const spaces = await this.targets(actorUserId);
    const ref = await this.configuredModel();
    // a space built earlier for this model (then left for another one) is finished now
    for (const s of spaces.filter((x) => x.status === 'building' && x.model === ref)) {
      await this.queue.add('backfill', { space: s.slug, actorUserId }, backfillOptions);
    }
    const dropped = await this.cleanup();
    return { spaces: spaces.map((s) => ({ slug: s.slug, status: s.status })), dropped };
  }

  async cleanup(now = new Date()) {
    const dropped = await this.rag.dropRetiredSpaces(
      new Date(now.getTime() - RETIRED_SPACE_DAYS * dayMs)
    );
    if (dropped.length) this.logger.log(`dropped retired embedding spaces ${dropped.join(', ')}`);
    return dropped;
  }

  /** What the agent and the admin see: the configured model and every space. */
  async status() {
    return {
      configuredModel: await this.configuredModel(),
      spaces: (await this.rag.listSpaces()).map(
        ({ slug, model, dimension, status, retiredAt }) => ({
          slug,
          model,
          dimension,
          status,
          retiredAt,
        })
      ),
    };
  }

  private async fill(slug: string, model: string) {
    let embedded = 0;
    for (;;) {
      const missing = await this.rag.chunksWithoutEmbedding(slug, EMBED_BATCH);
      if (!missing.length) return embedded;
      const vectors = await this.embed(
        model,
        missing.map((m) => m.text)
      );
      await this.rag.writeEmbeddings(
        slug,
        missing.map((m, i) => ({ chunkId: m.id, vector: vectors[i] }))
      );
      embedded += missing.length;
    }
  }
}

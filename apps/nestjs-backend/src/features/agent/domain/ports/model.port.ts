/* eslint-disable @typescript-eslint/naming-convention */
import type { EmbeddingModel, LanguageModel, RerankingModel } from 'ai';

/** `providerId/model`, as stored in agent_setup (e.g. `vllm-gpu01/qwen3-32b`). */
export type IModelRef = string;

export interface IResolvedModel {
  ref: IModelRef;
  /** The model key the rest of the app understands: `type@model@providerId`. */
  modelKey: string;
  model: Exclude<LanguageModel, string>;
}

/** USD per token, from the provider's model settings. */
export interface IModelPrice {
  input: number;
  output: number;
}

/** Turns the agent's model slots into callable models via the instance provider registry. */
export interface IModelPort {
  resolve(ref: IModelRef): Promise<IResolvedModel>;
  /** The embedding model of a slot (agent_setup.embedding_model). */
  embedder(ref: IModelRef): Promise<{ ref: IModelRef; modelKey: string; model: EmbeddingModel }>;
  /** The reranking model of a slot (agent_setup.rerank_model). */
  reranker(ref: IModelRef): Promise<{ ref: IModelRef; modelKey: string; model: RerankingModel }>;
  /** Undefined when the admin has not priced the model. */
  price(ref: IModelRef): Promise<IModelPrice | undefined>;
}

export const MODEL_PORT = Symbol('AGENT_MODEL_PORT');

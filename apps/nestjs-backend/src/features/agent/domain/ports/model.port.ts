/* eslint-disable @typescript-eslint/naming-convention */
import type { LanguageModel } from 'ai';

/** `providerId/model`, as stored in agent_setup (e.g. `vllm-gpu01/qwen3-32b`). */
export type IModelRef = string;

export interface IResolvedModel {
  ref: IModelRef;
  /** The model key the rest of the app understands: `type@model@providerId`. */
  modelKey: string;
  model: Exclude<LanguageModel, string>;
}

/** Turns the agent's model slots into callable models via the instance provider registry. */
export interface IModelPort {
  resolve(ref: IModelRef): Promise<IResolvedModel>;
}

export const MODEL_PORT = Symbol('AGENT_MODEL_PORT');

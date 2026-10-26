import type { IAgentStatusVo } from '@teable/openapi';
import type { IPickerGroup } from '../../../components/ai/model-picker-options';

/** `providerId/model` (what agent_setup stores) for a picked model key. */
export function keyToRef(key: string, groups: IPickerGroup[]): string | undefined {
  for (const g of groups) {
    const option = g.options.find((o) => o.key === key);
    if (option) return `${option.providerId}/${option.model}`;
  }
  return undefined;
}

/** The picker key for a stored ref, or undefined when no configured provider offers it. */
export function refToKey(ref: string | null | undefined, groups: IPickerGroup[]) {
  if (!ref) return undefined;
  for (const g of groups) {
    const option = g.options.find((o) => `${o.providerId}/${o.model}` === ref);
    if (option) return option.key;
  }
  return undefined;
}

export type IAgentAction = 'enable' | 'disable' | 'verify' | 'restore' | 'reset';

/** Which lifecycle buttons make sense in the current state. */
export function availableActions(status: IAgentStatusVo | undefined): IAgentAction[] {
  if (!status) return [];
  if (!status.enabled) return ['enable'];
  if (status.status === 'needs_setup') {
    return status.baseId ? ['restore', 'reset', 'disable'] : ['reset', 'disable'];
  }
  return ['verify', 'reset', 'disable'];
}

/** Toggle one value in a list, keeping the order of `all`. */
export function toggle<T extends string>(
  list: readonly T[],
  value: T,
  on: boolean,
  all: readonly T[]
) {
  const next = new Set(list);
  if (on) next.add(value);
  else next.delete(value);
  return all.filter((v) => next.has(v));
}

import type {
  GatewayModelTag,
  IAiProviderVo,
  IGatewayModel,
  IProviderHealthStatus,
  LLMProvider,
} from '@teable/openapi';
import { buildModelKey, findProviderForModelKey, LLMProviderType } from '@teable/openapi';

/** One selectable model, grouped under its provider. */
export interface IPickerOption {
  /** The model key saved when this option is picked: `type@model@<provider id>`. */
  key: string;
  model: string;
  label: string;
  providerId: string;
  providerName: string;
  providerType: LLMProviderType;
  providerStatus: IProviderHealthStatus;
  tags: GatewayModelTag[];
  isImageModel?: boolean;
}

export interface IPickerGroup {
  providerId: string;
  providerName: string;
  providerType: LLMProviderType;
  providerStatus: IProviderHealthStatus;
  options: IPickerOption[];
}

const GATEWAY_REF = 'teable';

/** Options from the admin provider list; Gateway models come from the Gateway model pool. */
export function buildPickerGroups(
  providers: IAiProviderVo[],
  gatewayModels: IGatewayModel[] = []
): IPickerGroup[] {
  return providers
    .filter((p) => p.enabled !== false)
    .map((p) => {
      const isGateway = p.type === LLMProviderType.AI_GATEWAY;
      const options: IPickerOption[] = isGateway
        ? gatewayModels
            .filter((m) => m.enabled)
            .map((m) => ({
              // Gateway keys keep their historical suffix; the backend routes them by type.
              key: `${LLMProviderType.AI_GATEWAY}@${m.id}@${GATEWAY_REF}`,
              model: m.id,
              label: m.label || m.id,
              providerId: p.id,
              providerName: p.name,
              providerType: p.type,
              providerStatus: p.status,
              tags: m.tags ?? [],
              isImageModel: m.modelType === 'image',
            }))
        : (p.models ?? '')
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean)
            .map((model) => {
              const config = p.modelConfigs?.[model];
              return {
                key: buildModelKey(p, model),
                model,
                label: config?.label || model,
                providerId: p.id,
                providerName: p.name,
                providerType: p.type,
                providerStatus: p.status,
                tags: config?.tags ?? [],
                isImageModel: config?.isImageModel,
              };
            });
      return {
        providerId: p.id,
        providerName: p.name,
        providerType: p.type,
        providerStatus: p.status,
        options,
      };
    })
    .filter((g) => g.options.length > 0);
}

/** Why an option cannot be picked here, or undefined when it can. */
export function disabledReason(
  option: IPickerOption,
  requires: GatewayModelTag[] = []
): string | undefined {
  const missing = requires.filter((tag) => !option.tags.includes(tag));
  if (missing.length) return `needs ${missing.join(', ')}`;
  if (option.isImageModel && !requires.includes('image-generation')) return 'image model';
  return undefined;
}

/**
 * The option a stored key refers to. Keys saved before provider ids (`…@teable`) resolve through
 * the same matcher the backend uses, so they show as selected.
 */
export function resolvePickerValue(
  value: string | undefined | null,
  groups: IPickerGroup[]
): IPickerOption | undefined {
  if (!value) return undefined;
  const all = groups.flatMap((g) => g.options);
  const exact = all.find((o) => o.key === value);
  if (exact) return exact;
  const providers: LLMProvider[] = groups.map((g) => ({
    id: g.providerId,
    type: g.providerType,
    name: g.providerName,
    models: g.options.map((o) => o.model).join(','),
    isInstance: true,
  }));
  const provider = findProviderForModelKey(value, providers);
  if (!provider) return undefined;
  const model = value.split('@').slice(1, -1).join('@');
  return all.find((o) => o.providerId === provider.id && o.model === model);
}

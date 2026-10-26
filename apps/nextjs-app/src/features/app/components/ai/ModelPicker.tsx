import type { GatewayModelTag } from '@teable/openapi';
import {
  Badge,
  Button,
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { AlertTriangle, Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import type { IPickerGroup } from './model-picker-options';
import { disabledReason, resolvePickerValue } from './model-picker-options';
import { ProviderIcon } from './ProviderIcon';

interface IModelPickerProps {
  value: string | undefined | null;
  onChange: (modelKey: string) => void;
  groups: IPickerGroup[];
  /** Capabilities a model must have here (e.g. tool-use for the agent's main model). */
  requires?: GatewayModelTag[];
  placeholder?: string;
  disabled?: boolean;
  /** Offer a "same as …" entry that clears the value. */
  clearLabel?: string;
  onClear?: () => void;
}

/**
 * Pick a model from every configured provider. Models that lack a required capability are shown
 * disabled with the reason; a model whose provider is not ready shows a warning.
 */
export const ModelPicker = (props: IModelPickerProps) => {
  const { value, onChange, groups, requires, placeholder, disabled, clearLabel, onClear } = props;
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => resolvePickerValue(value, groups), [value, groups]);
  const unknown = Boolean(value) && !selected;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid="model-picker"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected && <ProviderIcon type={selected.providerType} className="size-4" />}
            <span className="truncate">
              {selected
                ? `${selected.label} · ${selected.providerName}`
                : unknown
                  ? value
                  : clearLabel ?? placeholder ?? t('admin.setting.ai.selectModel', 'Select model')}
            </span>
            {selected && selected.providerStatus !== 'ready' && (
              <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('admin.setting.ai.searchModel', 'Search model')} />
          <CommandList className="max-h-80">
            <CommandEmpty>{t('admin.setting.ai.noModelFound', 'No model found')}</CommandEmpty>
            {clearLabel && onClear && (
              <CommandGroup>
                <CommandItem
                  value={`__clear__ ${clearLabel}`}
                  onSelect={() => {
                    onClear();
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 size-4', value ? 'opacity-0' : 'opacity-100')} />
                  {clearLabel}
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map((group) => (
              <CommandGroup
                key={group.providerId}
                heading={
                  <span className="flex items-center gap-1.5">
                    <ProviderIcon type={group.providerType} className="size-3.5" />
                    {group.providerName}
                    {group.providerStatus !== 'ready' && (
                      <span className="text-amber-600">· {group.providerStatus}</span>
                    )}
                  </span>
                }
              >
                {group.options.map((option) => {
                  const reason = disabledReason(option, requires);
                  return (
                    <CommandItem
                      key={option.key}
                      value={`${option.label} ${option.model} ${group.providerName}`}
                      disabled={Boolean(reason)}
                      onSelect={() => {
                        onChange(option.key);
                        setOpen(false);
                      }}
                      className="gap-2"
                    >
                      <Check
                        className={cn(
                          'size-4 shrink-0',
                          selected?.key === option.key ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {reason ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{reason}</span>
                      ) : (
                        option.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="px-1 text-[10px]">
                            {tag}
                          </Badge>
                        ))
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

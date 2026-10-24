import type { IEmailFolder } from '@teable/openapi';
import { EMAIL_SYNC_INTERVALS } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import {
  Checkbox,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

export interface ISyncOptions {
  includeAttachments: boolean;
  maxAttachmentMb: number;
  intervalMin: number;
}

export const FolderPicker = (props: {
  folders?: IEmailFolder[];
  isLoading: boolean;
  error?: string;
  value: IEmailFolder[];
  onChange: (folders: IEmailFolder[]) => void;
  disabled?: boolean;
}) => {
  const { folders, isLoading, error, value, onChange, disabled } = props;
  const { t } = useTranslation('common');
  const selected = new Set(value.map((folder) => folder.id));
  const toggle = (folder: IEmailFolder, checked: boolean) =>
    onChange(checked ? [...value, folder] : value.filter((item) => item.id !== folder.id));

  return (
    <div className="space-y-1">
      <Label>{t('emailTable.config.folders')}</Label>
      <ScrollArea className="h-36 rounded-md border">
        <div className="space-y-1 p-2">
          {isLoading && <Spin className="size-4" />}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!isLoading && !error && !folders?.length && (
            <p className="text-sm text-muted-foreground">{t('emailTable.config.noFolders')}</p>
          )}
          {folders?.map((folder) => (
            <label
              key={folder.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={selected.has(folder.id)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(folder, checked === true)}
              />
              <span className="truncate">{folder.name}</span>
            </label>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

/** Attachments and how often to check; shared by the wizard and the sync settings. */
export const SyncOptionFields = (props: {
  value: ISyncOptions;
  onChange: (value: ISyncOptions) => void;
}) => {
  const { value, onChange } = props;
  const { t } = useTranslation('common');
  const set = (patch: Partial<ISyncOptions>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="email-attachments">{t('emailTable.config.attachments')}</Label>
        <Switch
          id="email-attachments"
          checked={value.includeAttachments}
          onCheckedChange={(checked) => set({ includeAttachments: checked })}
        />
      </div>
      {value.includeAttachments && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="email-attachment-size" className="font-normal text-muted-foreground">
            {t('emailTable.config.maxAttachmentMb')}
          </Label>
          <Input
            id="email-attachment-size"
            className="w-24"
            inputMode="numeric"
            value={String(value.maxAttachmentMb)}
            onChange={(e) =>
              set({ maxAttachmentMb: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })
            }
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <Label>{t('emailTable.config.interval')}</Label>
        <Select
          value={String(value.intervalMin)}
          onValueChange={(next) => set({ intervalMin: Number(next) })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMAIL_SYNC_INTERVALS.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {t('emailTable.config.minutes', { count: minutes })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

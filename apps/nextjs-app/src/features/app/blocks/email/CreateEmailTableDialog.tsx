import { useBase } from '@cybernetics/sdk';
import { ReactQueryKeys } from '@cybernetics/sdk/config';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import type { IEmailFolder, IUserIntegrationItemVo } from '@teable/openapi';
import {
  BaseNodeResourceType,
  createEmailTable,
  UserIntegrationProvider,
  UserIntegrationStatus,
} from '@teable/openapi';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { usePublicSettingQuery } from '@/features/app/hooks/useSetting';
import { UserIntegrationProviderLogo } from '../../components/user-integration/ProviderLogo';
import { getNodeUrl } from '../base/base-node/hooks';
import { emailQueryKeys, useMailFolders, useMailIntegrations, useOAuthPopup } from './hooks';
import { ImapConnectForm } from './ImapConnectForm';
import type { ISyncOptions } from './SyncOptionFields';
import { FolderPicker, SyncOptionFields } from './SyncOptionFields';

enum Step {
  Account = 'account',
  Imap = 'imap',
  Configure = 'configure',
}

const RANGES = [
  { value: '30', days: 30, label: 'emailTable.config.range30' },
  { value: '90', days: 90, label: 'emailTable.config.range90' },
  { value: '365', days: 365, label: 'emailTable.config.range365' },
  { value: 'all', days: null, label: 'emailTable.config.rangeAll' },
] as const;

const DEFAULT_MAX_MESSAGES = 5000;

const AccountRow = (props: {
  integration: IUserIntegrationItemVo;
  selected: boolean;
  onSelect: () => void;
}) => {
  const { integration, selected, onSelect } = props;
  const { t } = useTranslation('common');
  const needsReauth = integration.status === UserIntegrationStatus.NeedsReauth;
  const email = (integration.metadata as { userInfo?: { email?: string } }).userInfo?.email;
  return (
    <button
      type="button"
      disabled={needsReauth}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border p-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60',
        selected && 'border-primary bg-accent'
      )}
    >
      <UserIntegrationProviderLogo provider={integration.provider} className="size-6" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{integration.name}</div>
        <div className="truncate text-xs text-muted-foreground">{email}</div>
      </div>
      {needsReauth && (
        <span className="text-xs text-destructive">{t('emailTable.account.needsReauth')}</span>
      )}
    </button>
  );
};

/** Create ▸ Email: pick or connect a mailbox, choose what to import, create the table. */
export const CreateEmailTableDialog = (props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { open, onOpenChange } = props;
  const { t } = useTranslation('common');
  const base = useBase();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: publicSetting } = usePublicSettingQuery();
  const oauthProviders = (
    [UserIntegrationProvider.Gmail, UserIntegrationProvider.Outlook] as const
  ).filter((provider) => publicSetting?.availableIntegrationProviders?.includes(provider));
  const { data: integrations } = useMailIntegrations();

  const [step, setStep] = useState(Step.Account);
  const [integrationId, setIntegrationId] = useState<string>();
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [folders, setFolders] = useState<IEmailFolder[]>([]);
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('90');
  const [maxMessages, setMaxMessages] = useState(DEFAULT_MAX_MESSAGES);
  const [options, setOptions] = useState<ISyncOptions>({
    includeAttachments: true,
    maxAttachmentMb: 25,
    intervalMin: 5,
  });
  const [error, setError] = useState('');

  const integration = integrations?.find((item) => item.id === integrationId);
  const foldersQuery = useMailFolders(step === Step.Configure ? integrationId : undefined);

  const refreshIntegrations = () =>
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getUserIntegrations() });

  const chooseIntegration = (id: string) => {
    setIntegrationId(id);
    setFolders([]);
    setName('');
    setStep(Step.Configure);
  };

  const openOAuth = useOAuthPopup((result) => {
    if (result.status === 'success' && result.integrationId) {
      setNotice('');
      refreshIntegrations().then(() => chooseIntegration(result.integrationId!));
    } else {
      setNotice(t('emailTable.account.failed', { message: result.message ?? '' }));
    }
  });

  // preselect the inbox once folders load
  useEffect(() => {
    if (!foldersQuery.data?.length || folders.length) return;
    const inbox =
      foldersQuery.data.find((folder) => ['INBOX', 'Inbox'].includes(folder.id)) ??
      foldersQuery.data.find((folder) => folder.name.toLowerCase() === 'inbox') ??
      foldersQuery.data[0];
    setFolders([inbox]);
  }, [foldersQuery.data, folders.length]);

  useEffect(() => {
    if (!open) {
      setStep(Step.Account);
      setIntegrationId(undefined);
      setNotice('');
      setError('');
    }
  }, [open]);

  const { mutate: create, isPending: creating } = useMutation({
    mutationFn: () => {
      const days = RANGES.find((item) => item.value === range)?.days ?? null;
      return createEmailTable(base.id, {
        integrationId: integrationId!,
        ...(name.trim() ? { name: name.trim() } : {}),
        folders,
        since: days ? new Date(Date.now() - days * 86_400_000).toISOString() : null,
        maxMessages,
        ...options,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }).then((res) => res.data);
    },
    onSuccess: ({ tableId, defaultViewId }) => {
      queryClient.invalidateQueries({ queryKey: emailQueryKeys.sources(base.id) });
      onOpenChange(false);
      const url = getNodeUrl({
        baseId: base.id,
        resourceType: BaseNodeResourceType.Table,
        resourceId: tableId,
        viewId: defaultViewId,
      });
      if (url) router.push(url, undefined, { shallow: true });
    },
    onError: (err: HttpError) => setError(err.message),
  });

  const foldersError = (foldersQuery.error as HttpError | null)?.message;
  const address = (integration?.metadata as { userInfo?: { email?: string } } | undefined)?.userInfo
    ?.email;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === Step.Imap ? t('emailTable.imap.title') : t('emailTable.dialog.title')}
          </DialogTitle>
          <DialogDescription>{t('emailTable.dialog.description')}</DialogDescription>
        </DialogHeader>

        {step === Step.Account && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('emailTable.account.existing')}</Label>
              {integrations?.length ? (
                integrations.map((item) => (
                  <AccountRow
                    key={item.id}
                    integration={item}
                    selected={item.id === integrationId}
                    onSelect={() => chooseIntegration(item.id)}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">{t('emailTable.account.empty')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('emailTable.account.connectNew')}</Label>
              <div className="grid gap-2">
                {oauthProviders.map((provider) => (
                  <Button
                    key={provider}
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() => {
                      setNotice(t('emailTable.account.waiting'));
                      openOAuth(provider);
                    }}
                  >
                    <UserIntegrationProviderLogo provider={provider} className="size-5" />
                    {t(`emailTable.account.${provider}`)}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  className="justify-start gap-2"
                  onClick={() => setStep(Step.Imap)}
                >
                  <UserIntegrationProviderLogo
                    provider={UserIntegrationProvider.Imap}
                    className="size-5"
                  />
                  {t('emailTable.account.imap')}
                </Button>
              </div>
              {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
            </div>
          </div>
        )}

        {step === Step.Imap && (
          <ImapConnectForm
            onCancel={() => setStep(Step.Account)}
            onConnected={(id) => {
              refreshIntegrations().then(() => chooseIntegration(id));
            }}
          />
        )}

        {step === Step.Configure && integration && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-sm">
              <UserIntegrationProviderLogo provider={integration.provider} className="size-5" />
              <span className="truncate">{address}</span>
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-table-name">{t('emailTable.config.name')}</Label>
              <Input
                id="email-table-name"
                placeholder={`Emails · ${address ?? ''}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <FolderPicker
              folders={foldersQuery.data}
              isLoading={foldersQuery.isLoading}
              error={foldersError}
              value={folders}
              onChange={setFolders}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t('emailTable.config.range')}</Label>
                <Select value={range} onValueChange={(v) => setRange(v as typeof range)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RANGES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {t(item.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="email-max-messages">{t('emailTable.config.maxMessages')}</Label>
                <Input
                  id="email-max-messages"
                  inputMode="numeric"
                  value={String(maxMessages)}
                  onChange={(e) =>
                    setMaxMessages(Math.min(50_000, Math.max(1, Number(e.target.value) || 1)))
                  }
                />
              </div>
            </div>
            <SyncOptionFields value={options} onChange={setOptions} />
            <p className="text-xs text-muted-foreground">{t('emailTable.dialog.privacy')}</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {step === Step.Configure && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStep(Step.Account)}>
              {t('emailTable.back')}
            </Button>
            <Button disabled={!folders.length || creating} onClick={() => create()}>
              {t('emailTable.config.create')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

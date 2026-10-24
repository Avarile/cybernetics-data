import { useLanDayjs, useSession, useTablePermission } from '@cybernetics/sdk/hooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import { AlertCircle, Loader2, Mail, RefreshCcw, Settings } from '@teable/icons';
import type { IEmailSourceVo, UserIntegrationProvider } from '@teable/openapi';
import {
  EmailSourceStatus,
  syncEmailSource,
  updateEmailSource,
  UserIntegrationProvider as UserIntegrationProviderEnum,
} from '@teable/openapi';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import type { IBaseResourceTable } from '@/features/app/hooks/useBaseResource';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { EmailSourceSettingsDialog } from './EmailSourceSettingsDialog';
import { emailQueryKeys, useEmailSource, useOAuthPopup } from './hooks';

const useStatusLabel = (source: IEmailSourceVo) => {
  const { t } = useTranslation('common');
  const dayjs = useLanDayjs();
  switch (source.status) {
    case EmailSourceStatus.Syncing:
      return t('emailTable.status.syncing');
    case EmailSourceStatus.Paused:
      return t('emailTable.status.paused');
    case EmailSourceStatus.Error:
      return t('emailTable.status.error');
    case EmailSourceStatus.Disconnected:
      return t('emailTable.status.disconnected');
    default:
      return source.lastSyncedTime
        ? t('emailTable.status.synced', { time: dayjs(source.lastSyncedTime).fromNow() })
        : t('emailTable.status.neverSynced');
  }
};

const StatusIcon = ({ status }: { status: EmailSourceStatus }) => {
  if (status === EmailSourceStatus.Syncing) return <Loader2 className="size-4 animate-spin" />;
  if (status === EmailSourceStatus.Error || status === EmailSourceStatus.Disconnected) {
    return <AlertCircle className="size-4 text-destructive" />;
  }
  return <Mail className="size-4" />;
};

/** Sync state of an email table, shown in its header; nothing for other tables. */
export const EmailSyncStatus = () => {
  const { baseId, tableId } = useBaseResource() as IBaseResourceTable;
  const source = useEmailSource(baseId, tableId);
  return source ? <EmailSyncStatusInner source={source} /> : null;
};

const EmailSyncStatusInner = ({ source }: { source: IEmailSourceVo }) => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { user } = useSession();
  const permission = useTablePermission();
  const canManage = Boolean(permission['table|update']);
  const isOwner = user?.id === source.createdBy;
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const label = useStatusLabel(source);
  const dayjs = useLanDayjs();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: emailQueryKeys.sources(source.baseId) });
  const onError = (err: HttpError) => toast.error(err.message);

  const { mutate: syncNow, isPending: syncing } = useMutation({
    mutationFn: () => syncEmailSource(source.baseId, source.id),
    onSuccess: () => {
      toast.success(t('emailTable.status.syncQueued'));
      refresh();
    },
    onError,
  });
  const { mutate: setPaused, isPending: pausing } = useMutation({
    mutationFn: (paused: boolean) => updateEmailSource(source.baseId, source.id, { paused }),
    onSuccess: refresh,
    onError,
  });
  // a reconnect clears the disconnected state on the server
  const reconnect = useOAuthPopup((result) => {
    if (result.status === 'success') refresh();
    else toast.error(result.message ?? t('emailTable.status.error'));
  });

  const paused = source.status === EmailSourceStatus.Paused;
  const disconnected = source.status === EmailSourceStatus.Disconnected;
  // OAuth mailboxes reconnect in a popup; a deleted integration has no provider left to reconnect
  const canReconnect =
    isOwner &&
    disconnected &&
    (source.provider === UserIntegrationProviderEnum.Gmail ||
      source.provider === UserIntegrationProviderEnum.Outlook);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className={cn(
              'shrink-0 gap-1.5 font-normal text-muted-foreground',
              disconnected && 'text-destructive'
            )}
          >
            <StatusIcon status={source.status} />
            <span className="hidden @md/view-header:inline">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3 text-sm">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">{t('emailTable.status.mailbox')}</dt>
            <dd className="truncate">{source.address}</dd>
            <dt className="text-muted-foreground">{t('emailTable.status.messages')}</dt>
            <dd>{source.messageCount}</dd>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-muted-foreground">
              {source.lastSyncedTime && dayjs(source.lastSyncedTime).format('YYYY-MM-DD HH:mm')}
            </dd>
          </dl>
          {source.lastError && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              <div className="font-medium">{t('emailTable.status.lastError')}</div>
              {source.lastError}
            </div>
          )}
          {disconnected && !isOwner && (
            <p className="text-xs text-muted-foreground">{t('emailTable.status.ownerOnly')}</p>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {canReconnect ? (
                <Button
                  size="xs"
                  onClick={() => reconnect(source.provider as UserIntegrationProvider)}
                >
                  {t('emailTable.status.reconnect')}
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  className="gap-1"
                  disabled={syncing || paused || disconnected}
                  onClick={() => syncNow()}
                >
                  <RefreshCcw className="size-3.5" />
                  {t('emailTable.status.syncNow')}
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                disabled={pausing || disconnected}
                onClick={() => setPaused(!paused)}
              >
                {paused ? t('emailTable.status.resume') : t('emailTable.status.pause')}
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="gap-1"
                onClick={() => {
                  setOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <Settings className="size-3.5" />
                {t('emailTable.status.settings')}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {canManage && (
        <EmailSourceSettingsDialog
          source={source}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </>
  );
};

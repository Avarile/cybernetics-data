import { useSession } from '@cybernetics/sdk/hooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import type { IEmailFolder, IEmailSourceVo } from '@teable/openapi';
import { updateEmailSource } from '@teable/openapi';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { emailQueryKeys, useMailFolders } from './hooks';
import type { ISyncOptions } from './SyncOptionFields';
import { FolderPicker, SyncOptionFields } from './SyncOptionFields';

/** Attachments and interval for any editor; the folders only for the mailbox owner. */
export const EmailSourceSettingsDialog = (props: {
  source: IEmailSourceVo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { source, open, onOpenChange } = props;
  const { t } = useTranslation('common');
  const { user } = useSession();
  const queryClient = useQueryClient();
  const isOwner = user?.id === source.createdBy;
  const [folders, setFolders] = useState<IEmailFolder[]>(source.config.folders);
  const [options, setOptions] = useState<ISyncOptions>(source.config);
  const [error, setError] = useState('');
  // only the owner can list the mailbox's folders
  const foldersQuery = useMailFolders(open && isOwner ? source.integrationId : undefined);

  useEffect(() => {
    if (open) {
      setFolders(source.config.folders);
      setOptions(source.config);
      setError('');
    }
  }, [open, source.config]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      updateEmailSource(source.baseId, source.id, {
        includeAttachments: options.includeAttachments,
        maxAttachmentMb: options.maxAttachmentMb,
        intervalMin: options.intervalMin,
        ...(isOwner ? { folders } : {}),
      }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: emailQueryKeys.sources(source.baseId) });
      toast.success(t('emailTable.settings.saved'));
      onOpenChange(false);
    },
    onError: (err: HttpError) => setError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('emailTable.settings.title')}</DialogTitle>
          <DialogDescription>{t('emailTable.settings.appliesToNew')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FolderPicker
            folders={isOwner ? foldersQuery.data : source.config.folders}
            isLoading={isOwner && foldersQuery.isLoading}
            error={(foldersQuery.error as HttpError | null)?.message}
            value={folders}
            onChange={setFolders}
            disabled={!isOwner}
          />
          {!isOwner && (
            <p className="text-xs text-muted-foreground">
              {t('emailTable.settings.foldersOwnerOnly')}
            </p>
          )}
          <SyncOptionFields value={options} onChange={setOptions} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button disabled={!folders.length || isPending} onClick={() => save()}>
            {t('emailTable.settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

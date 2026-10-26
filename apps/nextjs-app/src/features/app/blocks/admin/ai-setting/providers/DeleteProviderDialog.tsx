import type { HttpError } from '@cybernetics/core';
import type { IAiProviderVo } from '@teable/openapi';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useProviderMutations } from './useProviders';

/** Delete is refused while anything uses the provider; the dialog lists what does. */
export const DeleteProviderDialog = ({
  provider,
  onClose,
}: {
  provider: IAiProviderVo | null;
  onClose: () => void;
}) => {
  const { t } = useTranslation('common');
  const { remove } = useProviderMutations();
  const inUse = Boolean(provider?.usedBy.length);

  const confirm = async () => {
    if (!provider) return;
    try {
      await remove.mutateAsync(provider.id);
      toast.success(t('admin.setting.ai.providers.deleted', 'Provider deleted'));
      onClose();
    } catch (e) {
      toast.error((e as HttpError).message);
    }
  };

  return (
    <AlertDialog open={Boolean(provider)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {inUse
              ? t('admin.setting.ai.providers.inUseTitle', '{{name}} is in use', {
                  name: provider?.name,
                })
              : t('admin.setting.ai.providers.deleteTitle', 'Delete {{name}}?', {
                  name: provider?.name,
                })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {inUse ? (
                <>
                  <p>
                    {t(
                      'admin.setting.ai.providers.inUseDesc',
                      'Choose other models for these first, then delete the provider:'
                    )}
                  </p>
                  <ul className="list-disc pl-5">
                    {provider?.usedBy.map((u) => (
                      <li key={`${u.kind}-${u.label}`}>
                        {u.label} <code className="text-xs">{u.modelKey}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>
                  {t(
                    'admin.setting.ai.providers.deleteDesc',
                    'Its stored key is deleted too. This cannot be undone.'
                  )}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
          {!inUse && (
            <AlertDialogAction onClick={confirm} disabled={remove.isPending}>
              {t('actions.delete')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

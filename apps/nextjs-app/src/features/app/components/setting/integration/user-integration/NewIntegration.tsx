import { ReactQueryKeys } from '@cybernetics/sdk/config';
import { useQueryClient } from '@tanstack/react-query';
import { UserIntegrationProvider } from '@teable/openapi';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { ImapConnectForm } from '@/features/app/blocks/email';
import { usePublicSettingQuery } from '@/features/app/hooks/useSetting';
import { UserIntegrationProviderLogo } from '../../../user-integration/ProviderLogo';
import { getUserIntegrationName, openConnectIntegration } from '../../../user-integration/utils';

export const NewIntegration = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const [open, setOpen] = useState(false);
  const [imapOpen, setImapOpen] = useState(false);
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  const { data: publicSetting } = usePublicSettingQuery();
  const availableIntegrationProviders = publicSetting?.availableIntegrationProviders;

  const providers = Object.values(UserIntegrationProvider).filter((provider) =>
    availableIntegrationProviders?.includes(provider)
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger>{children}</PopoverTrigger>
        <PopoverContent className="h-auto w-64 p-2 text-[0px]">
          {providers.map((provider) => (
            <Button
              key={provider as string}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 px-2 text-sm font-normal"
              onClick={() => {
                setOpen(false);
                if (provider === UserIntegrationProvider.Imap) {
                  setImapOpen(true);
                  return;
                }
                openConnectIntegration(provider, {
                  name: t('settings.integration.userIntegration.defaultName', {
                    name: getUserIntegrationName(provider),
                  }),
                });
                setOpen(false);
              }}
            >
              <UserIntegrationProviderLogo provider={provider} className="size-5" />
              <span>{getUserIntegrationName(provider)}</span>
            </Button>
          ))}
        </PopoverContent>
      </Popover>
      <Dialog open={imapOpen} onOpenChange={setImapOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('emailTable.imap.title')}</DialogTitle>
          </DialogHeader>
          <ImapConnectForm
            onConnected={() => {
              setImapOpen(false);
              queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getUserIntegrations() });
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

import { useSession } from '@teable/sdk/hooks';
import { Badge, Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { usePublicSettingQuery } from '@/features/app/hooks/useSetting';
import { TwoFactorEmailDialog } from './TwoFactorEmailDialog';

export const maskEmail = (email: string) => {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return email;
  }
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) {
    return `${local[0]}•••••${domain}`;
  }
  return `${local[0]}•••••${local[local.length - 1]}${domain}`;
};

export const TwoFactorEmailRow = () => {
  const { t, i18n } = useTranslation('common');
  const { user } = useSession();
  const { data: setting } = usePublicSettingQuery();

  const enabled = Boolean(user.twoFactor?.email);
  const maskedEmail = maskEmail(user.email);
  // assume mail works until the setting says otherwise, so the row doesn't flash disabled
  const mailConfigured = setting?.mailConfigured ?? true;
  const enabledTime = user.twoFactor?.enabledTime;

  let description = t('settings.account.twoFactor.descOff', { email: maskedEmail });
  if (enabled) {
    description = t('settings.account.twoFactor.descOn', {
      date: enabledTime ? new Date(enabledTime).toLocaleDateString(i18n.language) : '',
    });
  } else if (!user.hasPassword) {
    description = t('settings.account.twoFactor.noPassword');
  } else if (!mailConfigured) {
    description = t('settings.account.twoFactor.mailNotConfigured');
  }

  // turning it off is always allowed, so nobody is locked in
  const canChange = enabled || (user.hasPassword && mailConfigured);
  const action = enabled ? 'disable' : 'enable';
  const button = (
    <Button
      className={enabled ? 'float-right text-destructive' : 'float-right'}
      size={'sm'}
      variant={'outline'}
      disabled={!canChange}
    >
      {enabled ? t('settings.account.twoFactor.disable') : t('settings.account.twoFactor.enable')}
    </Button>
  );

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border bg-card px-4 py-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{t('settings.account.twoFactor.title')}</p>
          <Badge
            variant={enabled ? 'default' : 'secondary'}
            className={
              enabled ? 'bg-green-600 text-white hover:bg-green-600/80 dark:bg-green-500' : ''
            }
          >
            {enabled ? t('settings.account.twoFactor.on') : t('settings.account.twoFactor.off')}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {canChange ? (
        <TwoFactorEmailDialog key={action} action={action} maskedEmail={maskedEmail}>
          {button}
        </TwoFactorEmailDialog>
      ) : (
        button
      )}
    </div>
  );
};

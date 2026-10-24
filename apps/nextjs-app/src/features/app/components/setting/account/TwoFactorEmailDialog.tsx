import type { HttpError } from '@cybernetics/core';
import { HttpErrorCode } from '@cybernetics/core';
import { useSession } from '@cybernetics/sdk/hooks';
import { useMutation } from '@tanstack/react-query';
import type { ITwoFactorEmailConfirmRo, ITwoFactorEmailSendCodeRo } from '@teable/openapi';
import {
  disableTwoFactorEmail,
  enableTwoFactorEmail,
  sendTwoFactorEmailCode,
} from '@teable/openapi';
import { Error as ErrorComponent, Spin } from '@teable/ui-lib/base';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useCutDown } from '@/features/app/hooks/useCutDown';
import { usePublicSettingQuery } from '@/features/app/hooks/useSetting';
import {
  TWO_FACTOR_CODE_LENGTH,
  TwoFactorCodeInput,
} from '@/features/auth/components/TwoFactorCodeInput';

interface ITwoFactorEmailDialogProps {
  action: ITwoFactorEmailSendCodeRo['action'];
  maskedEmail: string;
  children: React.ReactNode;
}

export function TwoFactorEmailDialog(props: ITwoFactorEmailDialogProps) {
  const { action, maskedEmail, children } = props;
  const { t } = useTranslation('common');
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const { countdown, setCountdown } = useCutDown();
  const { data: setting } = usePublicSettingQuery();
  const { twoFactorSendCodeMailRate } = setting ?? {};

  const reset = () => {
    setPassword('');
    setToken('');
    setCode('');
    setError('');
    setCountdown(0);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
    }
  };

  const onError = (error: HttpError) => {
    switch (error.code) {
      case HttpErrorCode.INVALID_CREDENTIALS:
        setError(t('settings.account.twoFactor.error.invalidPassword'));
        return;
      case HttpErrorCode.INVALID_CAPTCHA:
        setError(t('settings.account.twoFactor.error.invalidCode'));
        return;
      case HttpErrorCode.CONFLICT:
        // already changed elsewhere (another tab); show the current state
        refresh();
        onOpenChange(false);
        return;
      case HttpErrorCode.TOO_MANY_REQUESTS:
        if (error.data && typeof error.data === 'object' && 'seconds' in error.data) {
          setError(
            t('settings.account.twoFactor.error.sendMailRateLimit', {
              seconds: error.data.seconds,
            })
          );
          return;
        }
        setError(error.message);
        return;
      default:
        setError(error.message);
    }
  };

  const { mutate: sendCode, isPending: sendCodeLoading } = useMutation({
    mutationFn: sendTwoFactorEmailCode,
    onSuccess: (res) => {
      setToken(res.data.token);
      setCode('');
      setError('');
      toast.success(t('settings.account.twoFactor.success.codeSent'));
      if (typeof twoFactorSendCodeMailRate === 'number' && twoFactorSendCodeMailRate > 0) {
        setCountdown(twoFactorSendCodeMailRate);
      }
    },
    meta: {
      preventGlobalError: true,
    },
    onError,
  });

  const { mutate: confirm, isPending: confirmLoading } = useMutation({
    mutationFn: (ro: ITwoFactorEmailConfirmRo) =>
      action === 'enable' ? enableTwoFactorEmail(ro) : disableTwoFactorEmail(ro),
    onSuccess: () => {
      toast.success(
        action === 'enable'
          ? t('settings.account.twoFactor.success.enabled')
          : t('settings.account.twoFactor.success.disabled')
      );
      refresh();
      onOpenChange(false);
    },
    meta: {
      preventGlobalError: true,
    },
    onError: (error: HttpError) => {
      setCode('');
      onError(error);
    },
  });

  const submitCode = (value: string) => {
    if (value.length === TWO_FACTOR_CODE_LENGTH && !confirmLoading) {
      confirm({ token, code: value });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="md:w-[400px]">
        {!token ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">
                {action === 'enable'
                  ? t('settings.account.twoFactor.enableTitle')
                  : t('settings.account.twoFactor.disableTitle')}
              </DialogTitle>
              <DialogDescription className="text-sm">
                {t('settings.account.twoFactor.sendDesc', { email: maskedEmail })}
                {action === 'disable' && (
                  <span className="mt-1 block text-destructive">
                    {t('settings.account.twoFactor.disableWarning')}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (password) {
                  sendCode({ action, password });
                }
              }}
            >
              <div className="space-y-1">
                <Label className="font-normal text-foreground" htmlFor="twoFactorPassword">
                  {t('settings.account.twoFactor.password')}
                </Label>
                <Input
                  size="sm"
                  id="twoFactorPassword"
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                />
              </div>
              <ErrorComponent className="text-xs" error={error} />
              <Button
                className="w-full"
                size={'sm'}
                type="submit"
                disabled={!password || sendCodeLoading}
              >
                {sendCodeLoading && <Spin className="size-4" />}
                {t('settings.account.twoFactor.sendCode')}
              </Button>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">
                {t('settings.account.twoFactor.codeTitle')}
              </DialogTitle>
              <DialogDescription className="text-sm">
                {t('settings.account.twoFactor.codeDesc', { email: maskedEmail })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <TwoFactorCodeInput
                value={code}
                onChange={(value) => {
                  setCode(value);
                  setError('');
                }}
                onComplete={submitCode}
                disabled={confirmLoading}
                // the code field is the only thing to do on this step
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
              <div className="text-center text-xs">
                <Button
                  variant="link"
                  size="xs"
                  className="h-auto p-0 text-xs"
                  disabled={countdown > 0 || sendCodeLoading}
                  onClick={() => sendCode({ action, password })}
                >
                  {countdown > 0
                    ? t('settings.account.twoFactor.resendIn', { seconds: countdown })
                    : t('settings.account.twoFactor.resend')}
                </Button>
              </div>
              <ErrorComponent className="text-xs" error={error} />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  size={'sm'}
                  variant={'outline'}
                  onClick={() => {
                    setToken('');
                    setCode('');
                    setError('');
                  }}
                >
                  {t('settings.account.twoFactor.back')}
                </Button>
                <Button
                  className="flex-1"
                  size={'sm'}
                  disabled={code.length !== TWO_FACTOR_CODE_LENGTH || confirmLoading}
                  onClick={() => submitCode(code)}
                >
                  {confirmLoading && <Spin className="size-4" />}
                  {t('settings.account.twoFactor.confirm')}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useMutation } from '@tanstack/react-query';
import { HttpErrorCode, type HttpError } from '@teable/core';
import type { ITwoFactorChallenge } from '@teable/openapi';
import { resendSigninTwoFactor, signinTwoFactor } from '@teable/openapi';
import { Spin, Error as ErrorCom } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { useCutDown } from '@/features/app/hooks/useCutDown';
import { authConfig } from '../../i18n/auth.config';
import { TWO_FACTOR_CODE_LENGTH, TwoFactorCodeInput } from './TwoFactorCodeInput';

interface ITwoFactorCodeStepProps {
  challenge: ITwoFactorChallenge;
  resendAfter?: number;
  onSuccess?: () => void;
  // back to the password form; `reason` is shown there
  onBack: (reason?: string) => void;
}

const isExpired = (error: HttpError) =>
  Boolean(error.data && typeof error.data === 'object' && 'expired' in error.data);

export const TwoFactorCodeStep: FC<ITwoFactorCodeStepProps> = (props) => {
  const { resendAfter = 0, onSuccess, onBack } = props;
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const [challenge, setChallenge] = useState(props.challenge);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { countdown, setCountdown } = useCutDown();

  useEffect(() => {
    if (resendAfter > 0) {
      setCountdown(resendAfter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleError = (error: HttpError) => {
    if (isExpired(error)) {
      onBack(t('auth:twoFactor.expired'));
      return;
    }
    switch (error.code) {
      case HttpErrorCode.INVALID_CAPTCHA:
        setError(t('auth:twoFactor.invalidCode'));
        break;
      case HttpErrorCode.TOO_MANY_REQUESTS:
        if (error.data && typeof error.data === 'object' && 'minutes' in error.data) {
          setError(t('auth:signError.tooManyRequests', { minutes: error.data.minutes }));
        } else if (error.data && typeof error.data === 'object' && 'seconds' in error.data) {
          setError(t('auth:signupError.sendMailRateLimit', { seconds: error.data.seconds }));
        } else {
          setError(error.message);
        }
        break;
      default:
        setError(error.message);
    }
  };

  const { mutate: verify, isPending: verifyLoading } = useMutation({
    mutationFn: signinTwoFactor,
    onSuccess: () => {
      // keep the spinner while the page redirects
      setIsRedirecting(true);
      onSuccess?.();
    },
    onError: (error: HttpError) => {
      setCode('');
      handleError(error);
    },
    meta: {
      preventGlobalError: true,
    },
  });

  const { mutate: resend, isPending: resendLoading } = useMutation({
    mutationFn: resendSigninTwoFactor,
    onSuccess: (res) => {
      setChallenge(res.data);
      setCode('');
      setError(undefined);
      toast.success(t('auth:twoFactor.sent'));
      if (resendAfter > 0) {
        setCountdown(resendAfter);
      }
    },
    onError: handleError,
    meta: {
      preventGlobalError: true,
    },
  });

  const loading = verifyLoading || isRedirecting;

  const submit = (value: string) => {
    if (value.length === TWO_FACTOR_CODE_LENGTH && !loading) {
      verify({ challengeId: challenge.challengeId, code: value });
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(code);
      }}
    >
      <div className="text-center">
        <h3 className="text-base font-medium">{t('auth:twoFactor.title')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('auth:twoFactor.desc', { email: challenge.maskedEmail })}
        </p>
      </div>
      <TwoFactorCodeInput
        value={code}
        onChange={(value) => {
          setCode(value);
          setError(undefined);
        }}
        onComplete={submit}
        disabled={loading}
        // the code field is the only thing to do on this step
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <Button
        className="w-full"
        type="submit"
        disabled={loading || code.length !== TWO_FACTOR_CODE_LENGTH}
      >
        {loading && <Spin />}
        {t('auth:twoFactor.verify')}
      </Button>
      <div className="flex items-center justify-between text-xs">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-xs text-muted-foreground"
          disabled={countdown > 0 || resendLoading || loading}
          onClick={() => resend({ challengeId: challenge.challengeId })}
        >
          {countdown > 0
            ? t('auth:twoFactor.resendIn', { seconds: countdown })
            : t('auth:twoFactor.resend')}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-xs text-muted-foreground"
          disabled={loading}
          onClick={() => onBack()}
        >
          {t('auth:twoFactor.useDifferentAccount')}
        </Button>
      </div>
      <ErrorCom error={error} />
    </form>
  );
};

import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@teable/ui-lib/shadcn';

export const TWO_FACTOR_CODE_LENGTH = 6;

interface ITwoFactorCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export const TwoFactorCodeInput = (props: ITwoFactorCodeInputProps) => {
  const { value, onChange, onComplete, disabled, autoFocus } = props;
  return (
    <InputOTP
      maxLength={TWO_FACTOR_CODE_LENGTH}
      pattern="^[0-9]*$"
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      // the code field is the only thing to do on this step
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      containerClassName="justify-center"
    >
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  );
};

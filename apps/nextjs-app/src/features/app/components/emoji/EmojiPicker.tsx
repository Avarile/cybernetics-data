import emojiData from '@emoji-mart/data';
import EmojiPickerCom from '@emoji-mart/react';
import { useThemeMode } from '@teable/sdk/hooks';
import { cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import type { FC, PropsWithChildren } from 'react';

interface IEmojiPicker {
  className?: string;
  disabled?: boolean;
  onChange?: (emoji: string) => void;
  /** Inside a dialog, so the picker keeps wheel scrolling. */
  modal?: boolean;
}

export const EmojiPicker: FC<PropsWithChildren<IEmojiPicker>> = (props) => {
  const { children, className, onChange, disabled, modal } = props;
  const themeMode = useThemeMode();

  if (disabled) {
    return <div className={cn('rounded transition-colors', className)}>{children}</div>;
  }

  const onEmojiSelect = (emoji: { native: string }) => {
    onChange?.(emoji.native);
  };

  return (
    <Popover modal={modal}>
      <PopoverTrigger asChild>
        <div className={cn('rounded transition-colors', className)}>{children}</div>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0">
        <EmojiPickerCom theme={themeMode} data={emojiData} onEmojiSelect={onEmojiSelect} />
      </PopoverContent>
    </Popover>
  );
};

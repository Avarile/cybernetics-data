import type { SingleLineTextDisplayType } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { onMixedTextClick } from '../../editor/text/utils';
import { OverflowTooltip } from '../components';
import type { ICellValue } from '../type';

interface ICellText extends ICellValue<string | string[]> {
  displayType?: SingleLineTextDisplayType;
}

export const CellText = (props: ICellText) => {
  const { value, className, style, ellipsis } = props;
  const isMultiple = Array.isArray(value);
  const text = isMultiple ? value.filter((v) => v != null).join(', ') : value;
  // A joined lookup value is not a single url/email/phone, so only scalars are clickable.
  const displayType = isMultiple ? undefined : props.displayType;

  const onJump = () => {
    if (!displayType || !text) return;
    onMixedTextClick(displayType, text);
  };

  return (
    <OverflowTooltip
      text={text}
      ellipsis={ellipsis}
      className={cn(
        'w-full text-[13px] leading-5',
        displayType && 'cursor-pointer hover:underline hover:underline-offset-2 text-violet-500',
        className
      )}
      style={style}
      onClick={!displayType ? undefined : onJump}
    />
  );
};

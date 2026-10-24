import type { INumberFormatting } from '@teable/core';
import { NumberFormattingType, parseStringToNumber } from '@teable/core';
import { Input, cn } from '@teable/ui-lib';
import { isNumber } from 'lodash';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';

// Expand exponent notation (1e-7, 1e+21) into plain digits, since parseStringToNumber drops the "e".
const toPlainStr = (value: number): string => {
  const str = value.toString();
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(str);
  if (!match) return str;
  const [, sign, intPart, fracPart = '', exponent] = match;
  const digits = intPart + fracPart;
  const pointIndex = intPart.length + Number(exponent);
  if (pointIndex <= 0) return `${sign}0.${'0'.repeat(-pointIndex)}${digits}`;
  if (pointIndex >= digits.length) return sign + digits + '0'.repeat(pointIndex - digits.length);
  return `${sign}${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
};

const toDisplayStr = (value: number | null | undefined, isPercent: boolean): string => {
  if (!isNumber(value)) return '';
  return toPlainStr(isPercent ? parseFloat((value * 100).toPrecision(15)) : value);
};

export const NumberEditorBase: ForwardRefRenderFunction<
  IEditorRef<number>,
  ICellEditor<number | null> & {
    placeholder?: string;
    saveOnChange?: boolean;
    formatting?: INumberFormatting;
  }
> = (props, ref) => {
  const {
    value,
    onChange,
    className,
    readonly,
    style,
    saveOnBlur = true,
    saveOnChange = false,
    placeholder,
    formatting,
  } = props;
  const isPercent = formatting?.type === NumberFormattingType.Percent;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [str, setStr] = useState<string | null>(toDisplayStr(value, isPercent));

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue,
    saveValue,
  }));

  const setValue = (value?: number) => {
    setStr(typeof value === 'number' ? toDisplayStr(value, isPercent) : '');
  };

  const saveValue = () => {
    onChange?.(parseStringToNumber(str, formatting));
  };

  const onChangeHandler = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setStr(newValue);
    saveOnChange && onChange?.(parseStringToNumber(newValue, formatting));
  };

  return (
    <Input
      ref={inputRef}
      style={style}
      className={cn('h-10 sm:h-8', className)}
      value={str || ''}
      onChange={onChangeHandler}
      onBlur={() => saveOnBlur && !saveOnChange && saveValue()}
      readOnly={readonly}
      placeholder={placeholder}
    />
  );
};

export const NumberEditor = forwardRef(NumberEditorBase);

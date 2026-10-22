import { cn } from '@teable/ui-lib';
import React from 'react';

export interface ISelectTag {
  label: string;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  fontWeight?: number;
  className?: string;
}

export const SelectTag: React.FC<React.PropsWithChildren<ISelectTag>> = (props) => {
  const { label, color, backgroundColor, borderColor, fontWeight, className, children } = props;
  return (
    <div
      className={cn(
        'max-w-full text-xs px-1.5 h-5 rounded bg-secondary text-secondary-foreground flex items-center gap-1',
        className
      )}
      style={{
        color,
        backgroundColor,
        fontWeight,
        boxShadow: borderColor ? `inset 0 0 0 1px ${borderColor}` : undefined,
      }}
      title={label}
    >
      <span className="min-w-0 truncate">{label}</span>
      {children}
    </div>
  );
};

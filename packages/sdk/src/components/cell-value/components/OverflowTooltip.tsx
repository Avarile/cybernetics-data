import {
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipProvider,
  cn,
} from '@teable/ui-lib';
import React, { useState, useRef, useEffect, useCallback } from 'react';

interface IOverflowTooltipProps {
  text?: string;
  ellipsis?: boolean;
  className?: string;
  tooltipClassName?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const OverflowTooltip = (props: IOverflowTooltipProps) => {
  const { text = '', ellipsis = false, className, tooltipClassName, style, onClick } = props;
  const [isOverflow, setOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Both branches attach contentRef: the wrapped content overflows vertically,
  // the single-line tooltip trigger overflows horizontally.
  const checkOverflow = useCallback(() => {
    if (contentRef.current && ellipsis) {
      const element = contentRef.current;
      const lineHeight = parseInt(window.getComputedStyle(element).lineHeight);
      const isOverflow =
        element.scrollHeight > lineHeight || element.scrollWidth > element.clientWidth;
      setOverflow(isOverflow);
    }
  }, [ellipsis]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);
    return () => observer.disconnect();
    // Re-observe when switching branches, since each renders its own element
  }, [checkOverflow, isOverflow]);

  useEffect(() => {
    checkOverflow();
  }, [text, checkOverflow]);

  const Content = (
    <div
      ref={contentRef}
      className={cn('overflow-hidden whitespace-pre-wrap break-all line-clamp-6', className)}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick?.();
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={text}
      style={style}
    >
      {text}
    </div>
  );

  if (!ellipsis || !isOverflow) {
    return Content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          onClick={(e) => {
            if (onClick) {
              e.stopPropagation();
              onClick();
            }
          }}
          className="w-full text-left"
        >
          <div
            ref={contentRef}
            className={cn(className, 'overflow-hidden')}
            style={{
              ...style,
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {text}
          </div>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent className={cn('max-w-60 break-all', tooltipClassName)}>
            <p>{text}</p>
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};

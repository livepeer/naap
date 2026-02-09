/**
 * Tooltip Component
 * 
 * A hover tooltip component.
 */

import React, { useState, useRef, useCallback } from 'react';

export interface TooltipProps {
  /** Tooltip content */
  content: React.ReactNode;
  /** Trigger element */
  children: React.ReactNode;
  /** Position relative to trigger */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay before showing (ms) */
  delay?: number;
  /** Additional className for tooltip */
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  delay = 200,
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  }, [delay]);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  }, []);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-bg-tertiary',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-bg-tertiary',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-bg-tertiary',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-bg-tertiary',
  };

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      
      {isVisible && (
        <div
          className={`
            absolute z-50 ${positionClasses[position]}
            px-3 py-2 text-sm text-text-primary
            bg-bg-tertiary border border-white/10 rounded-lg shadow-lg
            whitespace-nowrap
            animate-in fade-in zoom-in-95 duration-150
            ${className}
          `}
          role="tooltip"
        >
          {content}
          {/* Arrow */}
          <div 
            className={`
              absolute w-0 h-0
              border-4 border-transparent
              ${arrowClasses[position]}
            `}
          />
        </div>
      )}
    </div>
  );
};

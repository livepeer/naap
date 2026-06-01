import React from 'react';

interface CapabilityTagProps {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  title?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export const CapabilityTag: React.FC<CapabilityTagProps> = ({
  children,
  active = false,
  onClick,
  onRemove,
  title,
  className = '',
  size = 'md',
}) => {
  const sizeClass = size === 'sm' ? 'pill-btn-sm' : '';
  const stateClass = active ? 'pill-btn-active' : 'pill-btn-inactive';
  const interactive = Boolean(onClick || onRemove);
  const base = [
    'pill-btn',
    stateClass,
    sizeClass,
    interactive ? '' : 'pill-btn-static',
    className,
  ].filter(Boolean).join(' ');

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onRemove ?? onClick}
        title={title}
        className={`inline-flex max-w-full items-center gap-1 ${base}`}
      >
        <span className="truncate max-w-[240px]">{children}</span>
        {onRemove && <span className="text-current/60" aria-hidden>×</span>}
      </button>
    );
  }

  return (
    <span title={title} className={`inline-flex max-w-full items-center ${base}`}>
      <span className="truncate">{children}</span>
    </span>
  );
};

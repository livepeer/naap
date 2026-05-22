import React from 'react';
import { Zap, type LucideIcon } from 'lucide-react';

interface SectionLabelProps {
  children: React.ReactNode;
  icon?: LucideIcon;
  trailing?: React.ReactNode;
  className?: string;
}

export const SectionLabel: React.FC<SectionLabelProps> = ({
  children,
  icon: Icon = Zap,
  trailing,
  className = '',
}) => (
  <div className={`flex items-center gap-2 mb-3 ${className}`.trim()}>
    <div className="section-label-icon" aria-hidden>
      <Icon size={14} />
    </div>
    <span className="section-label-text">{children}</span>
    {trailing}
  </div>
);

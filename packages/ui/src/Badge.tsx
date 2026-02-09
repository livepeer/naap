import React from 'react';

export type BadgeVariant = 'emerald' | 'blue' | 'amber' | 'rose' | 'secondary';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variants: Record<BadgeVariant, string> = {
  emerald: 'bg-accent-emerald/10 text-accent-emerald border-accent-emerald/20',
  blue: 'bg-accent-blue/10 text-accent-blue border-accent-blue/20',
  amber: 'bg-accent-amber/10 text-accent-amber border-accent-amber/20',
  rose: 'bg-accent-rose/10 text-accent-rose border-accent-rose/20',
  secondary: 'bg-bg-tertiary text-text-secondary border-white/5',
};

export const Badge: React.FC<BadgeProps> = ({ 
  children, 
  variant = 'emerald', 
  className = "" 
}) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${variants[variant]} ${className}`}>
    {children}
  </span>
);

import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ 
  children, 
  className = "", 
  title, 
  subtitle, 
  action, 
  ...props 
}) => (
  <div className={`glass-card p-6 ${className}`} {...props}>
    {(title || action) && (
      <div className="flex items-center justify-between mb-6 pointer-events-none">
        <div className="pointer-events-auto">
          {title && <h3 className="text-lg font-outfit font-semibold text-text-primary">{title}</h3>}
          {subtitle && <p className="text-sm text-text-secondary mt-1">{subtitle}</p>}
        </div>
        {action && <div className="pointer-events-auto">{action}</div>}
      </div>
    )}
    <div className="relative">
      {children}
    </div>
  </div>
);

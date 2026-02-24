import React from 'react';

export interface StatCardProps {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  value: string | number;
  suffix?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  icon: Icon,
  iconColor,
  label,
  value,
  suffix,
}) => (
  <div className="p-5 rounded-2xl bg-card border border-border hover:border-primary/30 transition-colors">
    <div className="flex items-center gap-2 mb-3">
      <div className={`p-1.5 rounded-lg ${iconColor}`}>
        <Icon className="w-4 h-4" />
      </div>
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
    <div className="flex items-baseline gap-1">
      <span className="text-3xl font-bold text-foreground tracking-tight">
        {value}
      </span>
      {suffix && (
        <span className="text-sm text-muted-foreground">{suffix}</span>
      )}
    </div>
  </div>
);

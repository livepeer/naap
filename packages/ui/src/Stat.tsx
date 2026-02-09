import React from 'react';
import { Card } from './Card';

export interface StatProps {
  label: string;
  value: string | number;
  trend?: number;
  prefix?: string;
  suffix?: string;
}

export const Stat: React.FC<StatProps> = ({ label, value, trend, prefix, suffix }) => (
  <Card>
    <p className="text-sm font-medium text-text-secondary mb-2">{label}</p>
    <div className="flex items-end justify-between">
      <h2 className="text-2xl font-mono font-bold text-text-primary">
        {prefix}{value}{suffix}
      </h2>
      {trend !== undefined && (
        <span className={`text-xs font-bold mb-1 ${trend >= 0 ? 'text-accent-emerald' : 'text-accent-rose'}`}>
          {trend >= 0 ? '+' : ''}{trend}%
        </span>
      )}
    </div>
  </Card>
);

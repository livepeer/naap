import React from 'react';
import { RISK_LABELS } from '../types';

interface RiskIndicatorProps {
  level: number;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export const RiskIndicator: React.FC<RiskIndicatorProps> = ({
  level,
  size = 'sm',
  showLabel = true,
}) => {
  const info = RISK_LABELS[level] || RISK_LABELS[1];
  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';

  const getBarColor = (index: number) => {
    if (index >= level) return 'bg-white/10';
    if (level <= 2) return 'bg-accent-blue';
    if (level <= 3) return 'bg-accent-amber';
    return 'bg-accent-rose';
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`${dotSize} rounded-full ${getBarColor(i)} transition-colors`}
          />
        ))}
      </div>
      {showLabel && (
        <span className={`text-xs font-medium ${info.color}`}>{info.label}</span>
      )}
    </div>
  );
};

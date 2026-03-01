import React from 'react';

const HEALTH_COLORS: Record<string, string> = {
  up: 'bg-green-400',
  down: 'bg-red-400',
  degraded: 'bg-yellow-400',
  unknown: 'bg-gray-500',
};

const HEALTH_LABELS: Record<string, string> = {
  up: 'Online',
  down: 'Offline',
  degraded: 'Degraded',
  unknown: 'Unknown',
};

const SIZE_CLASSES: Record<string, string> = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
};

interface HealthDotProps {
  status: string;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export const HealthDot: React.FC<HealthDotProps> = ({ status, size = 'sm', showLabel = false }) => {
  const color = HEALTH_COLORS[status] || HEALTH_COLORS.unknown;
  const label = HEALTH_LABELS[status] || HEALTH_LABELS.unknown;
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.sm;

  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className={`${sizeClass} rounded-full ${color} ${status === 'up' ? '' : ''}`} />
      {showLabel && (
        <span className={`text-xs ${status === 'up' ? 'text-green-400' : status === 'down' ? 'text-red-400' : status === 'degraded' ? 'text-yellow-400' : 'text-gray-500'}`}>
          {label}
        </span>
      )}
    </span>
  );
};

import React from 'react';

interface HealthIndicatorProps {
  status: string;
  size?: number;
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<string, { color: string; label: string; pulse: boolean }> = {
  GREEN: { color: '#22c55e', label: 'Healthy', pulse: false },
  ORANGE: { color: '#f59e0b', label: 'Degraded', pulse: true },
  RED: { color: '#ef4444', label: 'Offline', pulse: true },
  UNKNOWN: { color: '#a1a1aa', label: 'Unknown', pulse: false },
};

export const HealthIndicator: React.FC<HealthIndicatorProps> = ({ status, size = 10, showLabel = false }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.UNKNOWN;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block rounded-full shrink-0"
        style={{
          width: size,
          height: size,
          backgroundColor: config.color,
          boxShadow: config.pulse ? `0 0 0 3px ${config.color}33` : 'none',
          animation: config.pulse ? 'dm-pulse 2s infinite' : 'none',
        }}
      />
      {showLabel && (
        <span className="text-xs font-medium" style={{ color: config.color }}>
          {config.label}
        </span>
      )}
    </span>
  );
};

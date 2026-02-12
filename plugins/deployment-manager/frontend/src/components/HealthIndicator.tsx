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
  UNKNOWN: { color: '#9ca3af', label: 'Unknown', pulse: false },
};

export const HealthIndicator: React.FC<HealthIndicatorProps> = ({ status, size = 12, showLabel = false }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.UNKNOWN;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: config.color,
          display: 'inline-block',
          boxShadow: config.pulse ? `0 0 0 3px ${config.color}33` : 'none',
          animation: config.pulse ? 'pulse 2s infinite' : 'none',
        }}
      />
      {showLabel && (
        <span style={{ fontSize: '0.875rem', color: config.color, fontWeight: 500 }}>
          {config.label}
        </span>
      )}
    </span>
  );
};

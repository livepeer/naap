import React from 'react';

interface MetricGaugeProps {
  value: number;
  label: string;
  unit?: string;
  color?: string;
}

const COLOR_MAP: Record<string, string> = {
  green: 'text-green-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
  purple: 'text-purple-400',
  blue: 'text-blue-400',
};

export const MetricGauge: React.FC<MetricGaugeProps> = ({ value, label, unit = '', color = 'purple' }) => {
  const textColor = COLOR_MAP[color] || COLOR_MAP.purple;
  const formatted = value >= 1000
    ? `${(value / 1000).toFixed(1)}k`
    : value >= 1
    ? value.toFixed(1)
    : value.toFixed(3);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col items-center justify-center text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${textColor}`}>
        {formatted}
        {unit && <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>}
      </p>
    </div>
  );
};

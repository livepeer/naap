import React from 'react';
import type { OrchestratorStats } from '../types';

interface BarChartProps {
  data: OrchestratorStats[];
  valueKey: string;
  labelKey: string;
  color?: string;
  title?: string;
}

const COLOR_MAP: Record<string, { bar: string; text: string }> = {
  purple: { bar: 'bg-purple-500', text: 'text-purple-300' },
  blue: { bar: 'bg-blue-500', text: 'text-blue-300' },
  green: { bar: 'bg-green-500', text: 'text-green-300' },
  amber: { bar: 'bg-amber-500', text: 'text-amber-300' },
};

function getNestedValue(obj: Record<string, unknown>, key: string): number {
  const val = obj[key];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val) || 0;
  return 0;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export const BarChart: React.FC<BarChartProps> = ({ data, valueKey, labelKey, color = 'purple', title }) => {
  if (data.length === 0) return <div className="text-gray-500 text-xs text-center py-4">No data</div>;

  const values = data.map((d) => getNestedValue(d as unknown as Record<string, unknown>, valueKey));
  const maxVal = Math.max(...values, 0.001);
  const colors = COLOR_MAP[color] || COLOR_MAP.purple;

  return (
    <div className="space-y-2">
      {title && <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</h4>}
      <div className="space-y-1.5">
        {data.map((d, i) => {
          const val = values[i];
          const pct = (val / maxVal) * 100;
          const label = String((d as unknown as Record<string, unknown>)[labelKey] || `Item ${i}`);

          return (
            <div key={i} className="flex items-center gap-2 group">
              <span className="w-24 text-xs text-gray-400 truncate flex-shrink-0" title={label}>
                {truncateAddress(label)}
              </span>
              <div className="flex-1 h-5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={`h-full ${colors.bar} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <span className={`w-16 text-xs text-right ${colors.text} font-mono`}>
                {val >= 1 ? val.toFixed(1) : val.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

import React from 'react';

export interface BarChartItem {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  items: BarChartItem[];
  maxValue?: number;
}

const DEFAULT_COLORS = [
  'bg-emerald-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
];

export const BarChart: React.FC<BarChartProps> = ({ items, maxValue }) => {
  const max = maxValue ?? Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-2">
      {items.map((item, idx) => {
        const widthPct = Math.max((item.value / max) * 100, 2);
        return (
          <div key={item.label} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-28 truncate">
              {item.label}
            </span>
            <div className="flex-1 h-4 rounded-full bg-muted/30 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${item.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="text-xs font-mono text-foreground w-12 text-right">
              {item.value.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

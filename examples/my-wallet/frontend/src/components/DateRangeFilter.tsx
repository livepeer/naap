/**
 * Date range filter with preset pills and custom date inputs
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Calendar } from 'lucide-react';

interface DateRange {
  from: Date;
  to: Date;
}

interface DateRangeFilterProps {
  onChange: (range: DateRange | null) => void;
  className?: string;
}

type PresetKey = '7d' | '30d' | '90d' | '1y' | 'all';

const PRESETS: { key: PresetKey; label: string; days: number | null }[] = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null },
];

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ onChange, className = '' }) => {
  const [active, setActive] = useState<PresetKey>('90d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const handlePreset = useCallback((preset: typeof PRESETS[number]) => {
    setActive(preset.key);
    setShowCustom(false);

    if (preset.days === null) {
      onChange(null);
    } else {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - preset.days);
      onChange({ from, to });
    }
  }, [onChange]);

  const handleCustomApply = useCallback(() => {
    if (!customFrom || !customTo) return;
    setActive('7d'); // deselect presets visually
    onChange({
      from: new Date(customFrom),
      to: new Date(customTo),
    });
  }, [customFrom, customTo, onChange]);

  const maxDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <div className="flex rounded-lg bg-bg-secondary border border-white/5 p-0.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => handlePreset(preset)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              active === preset.key && !showCustom
                ? 'bg-accent-blue text-white'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(!showCustom)}
          className={`px-2 py-1 rounded-md transition-colors ${
            showCustom ? 'bg-accent-blue text-white' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
        </button>
      </div>

      {showCustom && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            max={maxDate}
            className="bg-bg-secondary border border-white/10 rounded px-2 py-1 text-xs text-text-primary"
          />
          <span className="text-text-muted text-xs">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            max={maxDate}
            className="bg-bg-secondary border border-white/10 rounded px-2 py-1 text-xs text-text-primary"
          />
          <button
            onClick={handleCustomApply}
            disabled={!customFrom || !customTo}
            className="px-2 py-1 text-xs bg-accent-blue text-white rounded disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
};

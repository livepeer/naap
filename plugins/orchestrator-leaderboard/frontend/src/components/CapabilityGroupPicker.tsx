import React from 'react';
import { Loader2, Search, X } from 'lucide-react';
import type { CapabilityCatalogPipeline } from '../lib/api';

interface CapabilityGroupPickerProps {
  title: string;
  pipelines: CapabilityCatalogPipeline[];
  loading: boolean;
  /** Full plan selection (may include out-of-catalog legacy or out-of-scope entries). */
  selectedCapabilities: string[];
  isSelected: (capability: string) => boolean;
  onToggle: (capability: string) => void;
}

export const CapabilityGroupPicker: React.FC<CapabilityGroupPickerProps> = ({
  title,
  pipelines,
  loading,
  selectedCapabilities,
  isSelected,
  onToggle,
}) => {
  const [query, setQuery] = React.useState('');

  const allOptions = React.useMemo(() => (
    pipelines.flatMap((pipeline) =>
      pipeline.models.map((model) => ({
        capability: model.capability,
        pipelineName: pipeline.name,
        label: `${pipeline.name} · ${model.label}`,
      })),
    )
  ), [pipelines]);

  const optionLabelByCapability = React.useMemo(
    () => new Map(allOptions.map((opt) => [opt.capability, opt.label])),
    [allOptions],
  );

  const filteredOptions = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((opt) =>
      opt.label.toLowerCase().includes(q) ||
      opt.capability.toLowerCase().includes(q),
    );
  }, [allOptions, query]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          {title} ({selectedCapabilities.length} selected)
        </label>
      </div>

      <div className="rounded-lg border border-[var(--border-color)] bg-bg-secondary p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {selectedCapabilities.length === 0 && (
            <span className="text-xs text-text-muted">No capabilities selected yet.</span>
          )}
          {selectedCapabilities.map((capability) => (
            <button
              key={capability}
              type="button"
              onClick={() => onToggle(capability)}
              className="inline-flex items-center gap-1 rounded-full bg-bg-tertiary px-2 py-1 text-xs text-text-primary border border-[var(--border-color)] hover:border-accent-emerald/50"
              title={capability}
            >
              <span className="truncate max-w-[240px]">
                {optionLabelByCapability.get(capability) ?? capability}
              </span>
              <X size={12} className="text-text-muted" />
            </button>
          ))}
        </div>

        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
            placeholder={loading ? 'Loading catalog...' : 'Search pipelines and models...'}
            className="w-full pl-8 pr-10 py-2 bg-bg-primary border border-[var(--border-color)] rounded-lg text-text-primary text-sm disabled:text-text-muted disabled:cursor-not-allowed"
          />
          {loading && (
            <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />
          )}
        </div>

        <div className="max-h-[220px] overflow-auto pr-1">
          <div className="flex flex-wrap gap-1.5">
            {filteredOptions.map((opt) => {
              const active = isSelected(opt.capability);
              return (
                <button
                  key={opt.capability}
                  type="button"
                  onClick={() => onToggle(opt.capability)}
                  className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                    active
                      ? 'bg-accent-emerald/20 text-accent-emerald border-accent-emerald/40'
                      : 'bg-bg-tertiary text-text-muted border-[var(--border-color)] hover:text-text-primary'
                  }`}
                  title={`${opt.pipelineName} (${opt.capability})`}
                >
                  {opt.label}
                </button>
              );
            })}
            {!loading && filteredOptions.length === 0 && (
              <span className="text-xs text-text-muted">No pipeline/model matches this search.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

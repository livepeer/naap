import React from 'react';
import { Loader2 } from 'lucide-react';
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
  const inputId = React.useId();
  const listboxId = `${inputId}-listbox`;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');

  const close = React.useCallback(() => {
    setOpen(false);
    setFilter('');
  }, []);

  React.useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDocPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [close, open]);

  React.useEffect(() => {
    if (!loading) {
      return undefined;
    }
    const timeoutId = globalThis.setTimeout(close, 0);
    return () => globalThis.clearTimeout(timeoutId);
  }, [close, loading]);

  const catalog = React.useMemo(() => (
    pipelines.map((pipeline) => ({
      ...pipeline,
      modelEntries: pipeline.models.map((model) => ({
        capability: model.capability,
        modelLabel: model.label,
      })),
    }))
  ), [pipelines]);

  const optionLabelByCapability = React.useMemo(
    () =>
      new Map(
        catalog.flatMap((pipeline) =>
          pipeline.modelEntries.map((entry) => [
            entry.capability,
            `${pipeline.name} · ${entry.modelLabel}`,
          ]),
        ),
      ),
    [catalog],
  );

  const q = filter.trim().toLowerCase();
  const filteredCatalog = React.useMemo(() => (
    catalog
      .map((pipeline) => {
        if (!q) {
          return pipeline;
        }
        const pipelineMatches =
          pipeline.name.toLowerCase().includes(q) ||
          pipeline.id.toLowerCase().includes(q);
        const filteredModelEntries = pipelineMatches
          ? pipeline.modelEntries
          : pipeline.modelEntries.filter((entry) => (
            entry.modelLabel.toLowerCase().includes(q) ||
            entry.capability.toLowerCase().includes(q)
          ));
        if (!pipelineMatches && filteredModelEntries.length === 0) {
          return null;
        }
        return {
          ...pipeline,
          modelEntries: filteredModelEntries,
        };
      })
      .filter(Boolean) as Array<
      CapabilityCatalogPipeline & {
        modelEntries: Array<{ capability: string; modelLabel: string }>;
      }
      >
  ), [catalog, q]);

  const togglePipeline = React.useCallback((pipeline: CapabilityCatalogPipeline) => {
    const selected = pipeline.models.filter((model) => isSelected(model.capability));
    if (selected.length === pipeline.models.length) {
      selected.forEach((model) => onToggle(model.capability));
      return;
    }
    pipeline.models
      .filter((model) => !isSelected(model.capability))
      .forEach((model) => onToggle(model.capability));
  }, [isSelected, onToggle]);

  return (
    <div ref={containerRef}>
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
              <span className="text-text-muted">×</span>
            </button>
          ))}
        </div>

        <div className="relative w-full">
          <input
            id={inputId}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-autocomplete="list"
            value={open ? filter : ''}
            placeholder={loading ? 'Loading catalog...' : 'Search pipelines and models...'}
            disabled={loading}
            onChange={(event) => {
              setFilter(event.target.value);
              if (!open) {
                setOpen(true);
              }
            }}
            onFocus={() => {
              if (!loading) {
                setOpen(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                close();
              }
            }}
            className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"
          />
          {loading && (
            <Loader2
              size={13}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 animate-spin"
            />
          )}
          {open && !loading && (
            <div
              id={listboxId}
              className="absolute z-50 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
            >
              {filteredCatalog.length === 0 ? (
                <div className="px-3 py-2 text-sm text-zinc-500">No matches</div>
              ) : (
                filteredCatalog.map((pipeline) => {
                  const selectedCount = pipeline.models.filter((model) =>
                    isSelected(model.capability)).length;
                  const allSelected = selectedCount === pipeline.models.length;
                  const someSelected = selectedCount > 0 && !allSelected;
                  let pipelineState: 'none' | 'some' | 'all' = 'none';
                  if (allSelected) {
                    pipelineState = 'all';
                  } else if (someSelected) {
                    pipelineState = 'some';
                  }
                  return (
                    <div key={pipeline.id}>
                      <button
                        type="button"
                        aria-pressed={allSelected}
                        onClick={() => togglePipeline(pipeline)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                      >
                        <PipelineCheckMark state={pipelineState} />
                        <span className="font-medium flex-1">{pipeline.name}</span>
                      </button>
                      {pipeline.modelEntries.map((entry) => {
                        const selected = isSelected(entry.capability);
                        return (
                          <button
                            key={entry.capability}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onToggle(entry.capability)}
                            className="w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                            title={entry.capability}
                          >
                            <ModelCheckMark checked={selected} />
                            <span className="truncate">{entry.modelLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function PipelineCheckMark({ state }: Readonly<{ state: 'none' | 'some' | 'all' }>) {
  const base = 'flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] font-bold leading-none';
  if (state === 'all') {
    return <span className={`${base} border-emerald-600 bg-emerald-600 text-white`}>✓</span>;
  }
  if (state === 'some') {
    return <span className={`${base} border-zinc-500 bg-zinc-800 text-zinc-400`}>—</span>;
  }
  return <span className={`${base} border-zinc-600 bg-transparent`} />;
}

function ModelCheckMark({ checked }: Readonly<{ checked: boolean }>) {
  const base = 'flex-shrink-0 w-3 h-3 rounded border flex items-center justify-center text-[8px] font-bold leading-none';
  if (checked) {
    return <span className={`${base} border-emerald-600 bg-emerald-600 text-white`}>✓</span>;
  }
  return <span className={`${base} border-zinc-600 bg-transparent`} />;
}

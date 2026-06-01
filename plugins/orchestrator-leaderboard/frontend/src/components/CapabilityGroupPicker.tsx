import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { CapabilityTag } from './CapabilityTag';
import { CollapsibleTagList } from './CollapsibleTagList';
import { SectionLabel } from './SectionLabel';
import type { CapabilityCatalogPipeline } from '../lib/api';

interface CapabilityGroupPickerProps {
  title: string;
  /** When false, parent renders the section header and may pass toolbarEnd. */
  showSectionHeader?: boolean;
  pipelines: CapabilityCatalogPipeline[];
  loading: boolean;
  /** Full plan selection (may include out-of-catalog legacy or out-of-scope entries). */
  selectedCapabilities: string[];
  isSelected: (capability: string) => boolean;
  onToggle: (capability: string) => void;
  /**
   * Called for bulk add/remove operations (select-all, clear-all, pipeline group toggle).
   * Receives the full set of capabilities to add or remove in a single update.
   * Falls back to looping onToggle if not provided.
   */
  onBulkToggle?: (capabilities: string[], select: boolean) => void;
  /** Renders on the right of the select-all row when the parent owns the section header. */
  toolbarEnd?: React.ReactNode;
}

export const CapabilityGroupPicker: React.FC<CapabilityGroupPickerProps> = ({
  title,
  showSectionHeader = true,
  pipelines,
  loading,
  selectedCapabilities,
  isSelected,
  onToggle,
  onBulkToggle,
  toolbarEnd,
}) => {
  const allCatalogCapabilities = React.useMemo(
    () => pipelines.flatMap((p) => p.models.map((m) => m.capability)),
    [pipelines],
  );

  const allSelected =
    allCatalogCapabilities.length > 0 &&
    allCatalogCapabilities.every((cap) => isSelected(cap));

  const handleToggleAll = React.useCallback(() => {
    if (allSelected) {
      const toRemove = allCatalogCapabilities.filter((cap) => isSelected(cap));
      if (onBulkToggle) {
        onBulkToggle(toRemove, false);
      } else {
        toRemove.forEach(onToggle);
      }
    } else {
      const toAdd = allCatalogCapabilities.filter((cap) => !isSelected(cap));
      if (onBulkToggle) {
        onBulkToggle(toAdd, true);
      } else {
        toAdd.forEach(onToggle);
      }
    }
  }, [allCatalogCapabilities, allSelected, isSelected, onBulkToggle, onToggle]);

  const inputId = React.useId();
  const listboxId = `${inputId}-listbox`;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [listPosition, setListPosition] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    setFilter('');
  }, []);

  React.useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDocPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || listRef.current?.contains(target)) {
        return;
      }
      close();
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

  const updateListPosition = React.useCallback(() => {
    const input = inputRef.current;
    if (!input) {
      setListPosition(null);
      return;
    }
    const rect = input.getBoundingClientRect();
    setListPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) {
      setListPosition(null);
      return undefined;
    }
    updateListPosition();
    globalThis.addEventListener('resize', updateListPosition);
    globalThis.addEventListener('scroll', updateListPosition, true);
    return () => {
      globalThis.removeEventListener('resize', updateListPosition);
      globalThis.removeEventListener('scroll', updateListPosition, true);
    };
  }, [open, updateListPosition, filter, pipelines.length, loading]);

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
  const hasCatalog = catalog.length > 0;
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
    const allPipelineSelected = pipeline.models.every((model) => isSelected(model.capability));
    if (allPipelineSelected) {
      const toRemove = pipeline.models.map((m) => m.capability);
      if (onBulkToggle) {
        onBulkToggle(toRemove, false);
      } else {
        toRemove.forEach(onToggle);
      }
    } else {
      const toAdd = pipeline.models.filter((m) => !isSelected(m.capability)).map((m) => m.capability);
      if (onBulkToggle) {
        onBulkToggle(toAdd, true);
      } else {
        toAdd.forEach(onToggle);
      }
    }
  }, [isSelected, onBulkToggle, onToggle]);

  const listContent = open ? (
    <>
      {loading ? (
        <div className="px-3 py-2 text-sm text-zinc-500">Loading catalog...</div>
      ) : filteredCatalog.length === 0 ? (
        <div className="px-3 py-2 text-sm text-zinc-500">
          {q ? 'No matches' : hasCatalog ? 'No capabilities available' : 'No capabilities in catalog'}
        </div>
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
    </>
  ) : null;

  const listPortal = open && listPosition && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        className="fixed z-[9999] max-h-72 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
        style={{
          top: listPosition.top,
          left: listPosition.left,
          width: listPosition.width,
        }}
      >
        {listContent}
      </div>,
      document.body,
    )
    : null;

  const selectAllControl = !loading && allCatalogCapabilities.length > 0 && (
    <button
      type="button"
      onClick={handleToggleAll}
      className="text-xs font-medium text-accent-emerald hover:text-accent-emerald/80 transition-colors"
    >
      {allSelected ? 'Clear all' : 'Select all'}
    </button>
  );

  return (
    <div ref={containerRef}>
      {showSectionHeader ? (
        <div className="flex items-center justify-between mb-3">
          <SectionLabel className="mb-0">
            {title} ({selectedCapabilities.length} selected)
          </SectionLabel>
          {selectAllControl}
        </div>
      ) : (
        (selectAllControl || toolbarEnd) && (
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>{selectAllControl}</div>
            {toolbarEnd}
          </div>
        )
      )}

      <div className="rounded-lg border border-[var(--border-color)] bg-bg-secondary p-3 space-y-3">
        <div className="relative w-full">
          <input
            ref={inputRef}
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
            onMouseDown={() => {
              if (!loading) {
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
          {listPortal}
        </div>

        <CollapsibleTagList
          isEmpty={selectedCapabilities.length === 0}
          emptyMessage="No capabilities selected yet."
        >
          {selectedCapabilities.map((capability) => (
            <CapabilityTag
              key={capability}
              active
              size="sm"
              title={capability}
              onRemove={() => onToggle(capability)}
            >
              {optionLabelByCapability.get(capability) ?? capability}
            </CapabilityTag>
          ))}
        </CollapsibleTagList>
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

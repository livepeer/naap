import React, { useState, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Search,
  Filter,
  Box,
  Cpu,
  MapPin,
  AlertCircle,
  Loader2, X, Copy, Check,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { NetworkModel } from '@naap/types';
import { useNetworkCapabilities } from '../../hooks/useNetworkCapabilities';
import { ModelCard } from '../models/ModelCard';
import { ModelDetailPanel } from '../models/ModelDetailPanel';
import { CompareDrawer } from '../models/CompareDrawer';
import { CreateKeyModal } from '../api-keys/CreateKeyModal';
import { shortGPUName } from '../../utils/gpu';
/** Shorten "NVIDIA GeForce RTX 5090" → "RTX 5090" for filter chip labels */

// Skeleton card for loading state
function SkeletonCard() {
  return (
    <div className="glass-card p-4 animate-pulse">
      <div className="h-4 bg-white/10 rounded w-3/4 mb-3" />
      <div className="h-3 bg-white/10 rounded w-1/2 mb-4" />
      <div className="h-3 bg-white/10 rounded w-full" />
    </div>
  );
}

type SortOption =
  | 'fps_desc'
  | 'latency_asc'
  | 'sla_desc'
  | 'orchestrators_desc'
  | 'regions_desc';

export const ModelsTab: React.FC = () => {
  const { models, gpuTypes, regions, loading, error } = useNetworkCapabilities();

  const [searchQuery, setSearchQuery]       = useState('');
  const [pipelineFilter, setPipelineFilter] = useState('all');
  const [gpuFilter, setGpuFilter]           = useState('all');
  const [regionFilter, setRegionFilter]     = useState('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [minFPS, setMinFPS] = useState(0);
  const [maxLatencyMs, setMaxLatencyMs] = useState(2000);
  const [minSLAPercent, setMinSLAPercent] = useState(0);
  const [minVRAMGB, setMinVRAMGB] = useState(0);
  const [realtimeOnly, setRealtimeOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('fps_desc');
  const [selectedModel, setSelectedModel]   = useState<NetworkModel | null>(null);
  const [compareModels, setCompareModels]   = useState<string[]>([]);
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
  const [createdKeyInfo, setCreatedKeyInfo] = useState<{
    projectName: string;
    providerDisplayName: string;
    rawKey: string;
  } | null>(null);
  const [createdKeyCopied, setCreatedKeyCopied] = useState(false);

  const filteredModels = useMemo(() => {
    let result = [...models];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.displayName.toLowerCase().includes(q) ||
          m.modelId.toLowerCase().includes(q) ||
          m.pipelineType.toLowerCase().includes(q) ||
          m.gpuHardware.some((g) => g.name.toLowerCase().includes(q)) ||
          m.regionCodes.some((r) => r.toLowerCase().includes(q)) ||
          m.regions.some((r) => r.toLowerCase().includes(q))
      );
    }

    if (pipelineFilter !== 'all') {
      result = result.filter((m) => m.pipelineType === pipelineFilter);
    }

    if (gpuFilter !== 'all') {
      result = result.filter((m) =>
        m.gpuHardware.some((g) => shortGPUName(g.name) === gpuFilter)
      );
    }

    if (regionFilter !== 'all') {
      result = result.filter((m) => m.regionCodes.includes(regionFilter));
    }

    result = result.filter((m) => {
      if (m.avgFPS < minFPS) return false;
      if (m.slaScore != null && m.slaScore * 100 < minSLAPercent) return false;
      if (m.slaScore == null && minSLAPercent > 0) return false;
      if (m.e2eLatencyMs != null && m.e2eLatencyMs > maxLatencyMs) return false;
      if (m.e2eLatencyMs == null && maxLatencyMs < 2000) return false;
      if (minVRAMGB > 0 && !m.gpuHardware.some((g) => g.memoryGB >= minVRAMGB)) return false;
      if (realtimeOnly && !m.isRealtime) return false;
      return true;
    });

    result.sort((a, b) => {
      switch (sortBy) {
        case 'latency_asc': {
          const aValue = a.e2eLatencyMs ?? Number.MAX_SAFE_INTEGER;
          const bValue = b.e2eLatencyMs ?? Number.MAX_SAFE_INTEGER;
          return aValue - bValue;
        }
        case 'sla_desc':
          return (b.slaScore ?? -1) - (a.slaScore ?? -1);
        case 'orchestrators_desc':
          return b.orchestratorCount - a.orchestratorCount;
        case 'regions_desc':
          return b.regionCodes.length - a.regionCodes.length;
        case 'fps_desc':
        default:
          return b.avgFPS - a.avgFPS;
      }
    });

    return result;
  }, [
    models,
    searchQuery,
    pipelineFilter,
    gpuFilter,
    regionFilter,
    minFPS,
    maxLatencyMs,
    minSLAPercent,
    minVRAMGB,
    realtimeOnly,
    sortBy,
  ]);

  const compareModelsList = useMemo(
    () => models.filter((m) => compareModels.includes(m.id)),
    [models, compareModels]
  );

  const toggleCompare = (modelId: string) => {
    setCompareModels((prev) => {
      if (prev.includes(modelId)) return prev.filter((id) => id !== modelId);
      if (prev.length >= 4) return prev;
      return [...prev, modelId];
    });
  };

  const handleCreateKey = () => {
    setShowCreateKeyModal(true);
  };

  return (
    <div className="flex gap-6 min-h-[600px]">
      {/* Left Column - Model Explorer */}
      <div className="w-[400px] flex flex-col shrink-0">
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
          <input
            type="text"
            placeholder="Search models, pipelines, GPUs, regions…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-emerald transition-all"
          />
        </div>

        {/* Pipeline type filter */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button
            onClick={() => setPipelineFilter('all')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              pipelineFilter === 'all'
                ? 'bg-accent-emerald text-white'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            <Box size={12} />
            All
          </button>
          {pipelineTypes.map((pt) => (
            <button
              key={pt}
              onClick={() => setPipelineFilter(pt === pipelineFilter ? 'all' : pt)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                pipelineFilter === pt
                  ? 'bg-accent-emerald text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              {pt}
            </button>
          ))}
        </div>

        {/* GPU filter */}
        {!loading && gpuTypes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button
              onClick={() => setGpuFilter('all')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                gpuFilter === 'all'
                  ? 'bg-accent-amber/80 text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              <Cpu size={12} />
              All GPUs
            </button>
            {gpuTypes.map((g) => (
              <button
                key={g}
                onClick={() => setGpuFilter(shortGPUName(g) === gpuFilter ? 'all' : shortGPUName(g))}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  gpuFilter === shortGPUName(g)
                    ? 'bg-accent-amber/80 text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                }`}
              >
                <Cpu size={12} />
                {shortGPUName(g)}
              </button>
            ))}
          </div>
        )}

        {/* Region filter */}
        {!loading && regions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button
              onClick={() => setRegionFilter('all')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                regionFilter === 'all'
                  ? 'bg-accent-blue/80 text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              <MapPin size={12} />
              All Regions
            </button>
            {regions.map((r) => (
              <button
                key={r.id}
                onClick={() => setRegionFilter(r.id === regionFilter ? 'all' : r.id)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  regionFilter === r.id
                    ? 'bg-accent-blue/80 text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                }`}
              >
                <MapPin size={12} />
                {r.name}
              </button>
            ))}
          </div>
        )}

        {/* Advanced constraints and sort */}
        <div className="mb-3 rounded-xl border border-white/10 bg-bg-tertiary/30">
          <button
            onClick={() => setShowAdvancedFilters((value) => !value)}
            className="w-full px-3 py-2.5 text-left flex items-center justify-between text-sm text-text-primary"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-text-secondary" />
              Advanced Filters
            </span>
            {showAdvancedFilters ? (
              <ChevronUp size={16} className="text-text-secondary" />
            ) : (
              <ChevronDown size={16} className="text-text-secondary" />
            )}
          </button>
          {showAdvancedFilters && (
            <div className="px-3 pb-3 space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                  <span>Min FPS</span>
                  <span className="font-mono">{minFPS}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="range"
                    min={0}
                    max={120}
                    step={1}
                    value={minFPS}
                    onChange={(e) => setMinFPS(Number(e.target.value))}
                    className="w-full"
                  />
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={minFPS}
                    onChange={(e) => setMinFPS(Math.max(0, Number(e.target.value) || 0))}
                    className="w-16 bg-bg-secondary border border-white/10 rounded px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                  <span>Max Latency (ms)</span>
                  <span className="font-mono">{maxLatencyMs}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="range"
                    min={50}
                    max={2000}
                    step={10}
                    value={maxLatencyMs}
                    onChange={(e) => setMaxLatencyMs(Number(e.target.value))}
                    className="w-full"
                  />
                  <input
                    type="number"
                    min={50}
                    max={2000}
                    value={maxLatencyMs}
                    onChange={(e) => setMaxLatencyMs(Math.max(50, Number(e.target.value) || 50))}
                    className="w-20 bg-bg-secondary border border-white/10 rounded px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                  <span>Min SLA (%)</span>
                  <span className="font-mono">{minSLAPercent}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={minSLAPercent}
                    onChange={(e) => setMinSLAPercent(Number(e.target.value))}
                    className="w-full"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={minSLAPercent}
                    onChange={(e) => setMinSLAPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                    className="w-16 bg-bg-secondary border border-white/10 rounded px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-text-secondary">
                  Min VRAM (GB)
                  <input
                    type="number"
                    min={0}
                    value={minVRAMGB}
                    onChange={(e) => setMinVRAMGB(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 w-full bg-bg-secondary border border-white/10 rounded px-2 py-1 text-xs font-mono"
                  />
                </label>

                <label className="text-xs text-text-secondary">
                  Sort by
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="mt-1 w-full bg-bg-secondary border border-white/10 rounded px-2 py-1 text-xs"
                  >
                    <option value="fps_desc">FPS (high to low)</option>
                    <option value="latency_asc">Latency (low to high)</option>
                    <option value="sla_desc">SLA score (high to low)</option>
                    <option value="orchestrators_desc">Orchestrators (high to low)</option>
                    <option value="regions_desc">Regions (high to low)</option>
                  </select>
                </label>
              </div>

              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={realtimeOnly}
                  onChange={(e) => setRealtimeOnly(e.target.checked)}
                />
                Realtime models only
              </label>
            </div>
          )}
        </div>

        {/* Model list */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : error ? (
            <div className="flex flex-col items-center py-12 text-text-secondary gap-3">
              <AlertCircle size={32} className="opacity-40" />
              <p className="text-sm text-center">Failed to load network data</p>
              <p className="text-xs text-center opacity-60">{error}</p>
            </div>
          ) : filteredModels.length > 0 ? (
            filteredModels.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                isSelected={selectedModel?.id === model.id}
                isComparing={compareModels.includes(model.id)}
                onSelect={() => setSelectedModel(model)}
                onToggleCompare={() => toggleCompare(model.id)}
              />
            ))
          ) : (
            <div className="text-center py-12 text-text-secondary">
              <Filter size={32} className="mx-auto mb-3 opacity-30" />
              <p>No models match your filters</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Column - Detail Panel */}
      <div className="flex-1 glass-card p-6 overflow-hidden">
        <AnimatePresence mode="wait">
          {loading ? (
            <div className="h-full flex items-center justify-center text-text-secondary gap-3">
              <Loader2 size={24} className="animate-spin opacity-40" />
              <span className="text-sm">Loading network data…</span>
            </div>
          ) : selectedModel ? (
            <ModelDetailPanel
              key={selectedModel.id}
              model={selectedModel}
              onClose={() => setSelectedModel(null)}
              onCreateKey={handleCreateKey}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <Box size={48} className="text-text-secondary opacity-30 mb-4" />
              <h3 className="text-lg font-bold text-text-primary mb-2">Select a Model</h3>
              <p className="text-text-secondary text-sm max-w-sm">
                Choose a model from the list to view GPU fleet details, live performance metrics, and available gateways.
              </p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Compare Drawer */}
      <AnimatePresence>
        {compareModelsList.length > 0 && (
          <CompareDrawer
            models={compareModelsList}
            onRemove={(id) => toggleCompare(id)}
            onClear={() => setCompareModels([])}
            onSelect={(model) => setSelectedModel(model)}
          />
        )}
      </AnimatePresence>

      {/* Created Key Banner */}
      {createdKeyInfo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg bg-bg-secondary border border-accent-emerald/30 rounded-2xl shadow-2xl p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-sm font-semibold text-accent-emerald">API Key Created</p>
            <button
              onClick={() => setCreatedKeyInfo(null)}
              className="p-1 hover:bg-white/5 rounded-lg transition-colors shrink-0"
            >
              <X size={14} className="text-text-secondary" />
            </button>
          </div>
          <p className="text-xs text-text-secondary mb-2">
            Project: <span className="text-text-primary">{createdKeyInfo.projectName}</span>
            {' · '}Provider: <span className="text-text-primary">{createdKeyInfo.providerDisplayName}</span>
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-bg-tertiary border border-white/10 rounded-xl py-2 px-3 font-mono text-xs text-text-primary overflow-x-auto">
              {createdKeyInfo.rawKey}
            </div>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(createdKeyInfo.rawKey);
                } catch {
                  const ta = document.createElement('textarea');
                  ta.value = createdKeyInfo.rawKey;
                  ta.style.position = 'fixed';
                  ta.style.opacity = '0';
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand('copy');
                  document.body.removeChild(ta);
                }
                setCreatedKeyCopied(true);
                setTimeout(() => setCreatedKeyCopied(false), 2000);
              }}
              className={`shrink-0 p-2 rounded-xl transition-all ${
                createdKeyCopied
                  ? 'bg-accent-emerald text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              {createdKeyCopied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <p className="text-xs text-accent-amber mt-2">Save this key — it won't be shown again.</p>
        </div>
      )}

      {/* Create Key Modal */}
      {showCreateKeyModal && (
        <CreateKeyModal
          onClose={() => setShowCreateKeyModal(false)}
          onSuccess={() => setShowCreateKeyModal(false)}
        />
      )}
    </div>
  );
};

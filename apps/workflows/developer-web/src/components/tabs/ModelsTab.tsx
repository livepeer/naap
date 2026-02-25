import React, { useState, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Search, Filter, Box, Cpu, MapPin, AlertCircle, Loader2, X, Copy, Check } from 'lucide-react';
import type { NetworkModel } from '@naap/types';
import { useNetworkCapabilities } from '../../hooks/useNetworkCapabilities';
import { ModelCard } from '../models/ModelCard';
import { ModelDetailPanel } from '../models/ModelDetailPanel';
import { CompareDrawer } from '../models/CompareDrawer';
import { CreateKeyModal } from '../api-keys/CreateKeyModal';

/** Shorten "NVIDIA GeForce RTX 5090" → "RTX 5090" for filter chip labels */
function shortGPUName(name: string): string {
  return name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '');
}

function SkeletonCard() {
  return (
    <div className="glass-card p-4 animate-pulse">
      <div className="h-4 bg-white/10 rounded w-3/4 mb-3" />
      <div className="h-3 bg-white/10 rounded w-1/2 mb-4" />
      <div className="h-3 bg-white/10 rounded w-full" />
    </div>
  );
}

export const ModelsTab: React.FC = () => {
  const { models, gpuTypes, regions, loading, error } = useNetworkCapabilities();

  const [searchQuery, setSearchQuery]       = useState('');
  const [pipelineFilter, setPipelineFilter] = useState('all');
  const [gpuFilter, setGpuFilter]           = useState('all');
  const [regionFilter, setRegionFilter]     = useState('all');
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

    return result;
  }, [models, searchQuery, pipelineFilter, gpuFilter, regionFilter]);

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

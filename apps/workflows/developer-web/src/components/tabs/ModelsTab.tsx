import React, { useState, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Search, Filter, Star, Zap, DollarSign, Video, Image, Film, Box } from 'lucide-react';
import type { AIModel } from '@naap/types';
import { mockModels, mockGatewayOffers } from '../../data/mockData';
import { ModelCard } from '../models/ModelCard';
import { ModelDetailPanel } from '../models/ModelDetailPanel';
import { CompareDrawer } from '../models/CompareDrawer';
import { CreateKeyModal } from '../api-keys/CreateKeyModal';

type FilterType = 'all' | 'featured' | 'text-to-video' | 'image-to-video' | 'video-to-video' | 'realtime' | 'low-cost' | 'high-quality';

interface FilterChip {
  id: FilterType;
  label: string;
  icon: React.ReactNode;
}

const filterChips: FilterChip[] = [
  { id: 'all', label: 'All', icon: <Box size={14} /> },
  { id: 'featured', label: 'Featured', icon: <Star size={14} /> },
  { id: 'text-to-video', label: 'Text-to-Video', icon: <Video size={14} /> },
  { id: 'image-to-video', label: 'Image-to-Video', icon: <Image size={14} /> },
  { id: 'video-to-video', label: 'Video-to-Video', icon: <Film size={14} /> },
  { id: 'realtime', label: 'Real-time', icon: <Zap size={14} /> },
  { id: 'low-cost', label: 'Low-cost', icon: <DollarSign size={14} /> },
];

export const ModelsTab: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
  const [compareModels, setCompareModels] = useState<string[]>([]);
  const [createKeyModal, setCreateKeyModal] = useState<{ model: AIModel } | null>(null);

  const filteredModels = useMemo(() => {
    let result = [...mockModels];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.tagline.toLowerCase().includes(query) ||
          m.useCases.some((uc) => uc.toLowerCase().includes(query))
      );
    }

    // Type/feature filter
    switch (activeFilter) {
      case 'featured':
        result = result.filter((m) => m.featured);
        break;
      case 'text-to-video':
      case 'image-to-video':
      case 'video-to-video':
        result = result.filter((m) => m.type === activeFilter);
        break;
      case 'realtime':
        result = result.filter((m) => m.realtime);
        break;
      case 'low-cost':
        result = result.filter((m) => m.costPerMin.min <= 0.05);
        break;
    }

    return result;
  }, [searchQuery, activeFilter]);

  const compareModelsList = useMemo(() => {
    return mockModels.filter((m) => compareModels.includes(m.id));
  }, [compareModels]);

  const toggleCompare = (modelId: string) => {
    setCompareModels((prev) => {
      if (prev.includes(modelId)) {
        return prev.filter((id) => id !== modelId);
      }
      if (prev.length >= 4) {
        return prev; // Max 4 models
      }
      return [...prev, modelId];
    });
  };

  const handleCreateKey = (model: AIModel) => {
    setCreateKeyModal({ model });
  };

  return (
    <div className="flex gap-6 min-h-[600px]">
      {/* Left Column - Model Explorer */}
      <div className="w-[400px] flex flex-col shrink-0">
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
          <input
            type="text"
            placeholder="Search models (SDXL, VACE...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-emerald transition-all"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              onClick={() => setActiveFilter(chip.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeFilter === chip.id
                  ? 'bg-accent-emerald text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              {chip.icon}
              {chip.label}
            </button>
          ))}
        </div>

        {/* Model Cards */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
          {filteredModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              isSelected={selectedModel?.id === model.id}
              isComparing={compareModels.includes(model.id)}
              onSelect={() => setSelectedModel(model)}
              onToggleCompare={() => toggleCompare(model.id)}
            />
          ))}
          {filteredModels.length === 0 && (
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
          {selectedModel ? (
            <ModelDetailPanel
              key={selectedModel.id}
              model={selectedModel}
              gatewayOffers={mockGatewayOffers[selectedModel.id] || []}
              onClose={() => setSelectedModel(null)}
              onCreateKey={handleCreateKey}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <Box size={48} className="text-text-secondary opacity-30 mb-4" />
              <h3 className="text-lg font-bold text-text-primary mb-2">Select a Model</h3>
              <p className="text-text-secondary text-sm max-w-sm">
                Choose a model from the list to view details, compare performance metrics, and create an API key.
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

      {/* Create Key Modal */}
      {createKeyModal && (
        <CreateKeyModal
          preselectedModel={createKeyModal.model}
          onClose={() => setCreateKeyModal(null)}
          onSuccess={() => {
            setCreateKeyModal(null);
            // Could navigate to API Keys tab
          }}
        />
      )}
    </div>
  );
};

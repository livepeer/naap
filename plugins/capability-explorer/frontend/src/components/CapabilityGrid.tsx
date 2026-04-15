import React from 'react';
import type { EnrichedCapability, ViewMode } from '../lib/types';
import { CapabilityCard } from './CapabilityCard';
import { MetricsBadge } from './MetricsBadge';
import { CategoryBadge } from './CategoryBadge';

interface CapabilityGridProps {
  capabilities: EnrichedCapability[];
  viewMode: ViewMode;
  onSelect: (cap: EnrichedCapability) => void;
}

const ListRow: React.FC<{ capability: EnrichedCapability; onClick: (cap: EnrichedCapability) => void }> = ({ capability, onClick }) => (
  <div
    className="glass-card p-4 flex items-center gap-4 cursor-pointer hover:border-accent-emerald/30 transition-all"
    onClick={() => onClick(capability)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => e.key === 'Enter' && onClick(capability)}
    data-testid={`capability-row-${capability.id}`}
  >
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-semibold text-text-primary text-sm truncate">{capability.name}</h3>
        <CategoryBadge category={capability.category} />
      </div>
      {capability.description && (
        <p className="text-xs text-text-secondary truncate">{capability.description}</p>
      )}
    </div>
    <MetricsBadge
      gpuCount={capability.gpuCount}
      avgLatencyMs={capability.avgLatencyMs}
      meanPriceUsd={capability.meanPriceUsd}
    />
    <span className="text-xs text-text-muted whitespace-nowrap">
      {capability.models.length} model{capability.models.length !== 1 ? 's' : ''}
    </span>
  </div>
);

export const CapabilityGrid: React.FC<CapabilityGridProps> = ({ capabilities, viewMode, onSelect }) => {
  if (capabilities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-muted" data-testid="empty-state">
        <p className="text-lg font-medium mb-1">No capabilities found</p>
        <p className="text-sm">Try adjusting your filters or search query.</p>
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="space-y-2" data-testid="capability-list">
        {capabilities.map((cap) => (
          <ListRow key={cap.id} capability={cap} onClick={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      data-testid="capability-grid"
    >
      {capabilities.map((cap) => (
        <CapabilityCard key={cap.id} capability={cap} onClick={onSelect} />
      ))}
    </div>
  );
};

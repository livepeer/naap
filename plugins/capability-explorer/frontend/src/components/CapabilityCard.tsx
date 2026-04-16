import React from 'react';
import type { EnrichedCapability } from '../lib/types';
import { PLACEHOLDER_THUMBNAILS } from '../lib/constants';
import { CategoryBadge } from './CategoryBadge';
import { MetricsBadge } from './MetricsBadge';
import { Layers } from 'lucide-react';

interface CapabilityCardProps {
  capability: EnrichedCapability;
  onClick: (cap: EnrichedCapability) => void;
}

export const CapabilityCard: React.FC<CapabilityCardProps> = ({ capability, onClick }) => {
  const thumbnail = capability.thumbnail || PLACEHOLDER_THUMBNAILS[capability.category];

  return (
    <div
      className="capability-card group"
      onClick={() => onClick(capability)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(capability)}
      data-testid={`capability-card-${capability.id}`}
    >
      <div className="aspect-[16/10] rounded-lg overflow-hidden mb-3 bg-bg-tertiary flex items-center justify-center">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={capability.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <Layers className="text-text-muted" size={48} />
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-text-primary text-sm truncate group-hover:text-accent-emerald transition-colors">
            {capability.name}
          </h3>
          <CategoryBadge category={capability.category} />
        </div>

        {capability.description && (
          <p className="text-xs text-text-secondary line-clamp-2">
            {capability.description}
          </p>
        )}

        <MetricsBadge
          gpuCount={capability.gpuCount}
          avgLatencyMs={capability.avgLatencyMs}
          meanPriceUsd={capability.meanPriceUsd}
        />

        <div className="flex items-center justify-between text-xs text-text-muted pt-1">
          <span>{capability.models.length} model{capability.models.length !== 1 ? 's' : ''}</span>
          <span>{capability.orchestratorCount} orchestrator{capability.orchestratorCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
};

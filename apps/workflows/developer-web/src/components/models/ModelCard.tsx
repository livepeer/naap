import React from 'react';
import { motion } from 'framer-motion';
import { Clock, DollarSign, Server, Check } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { AIModel } from '@naap/types';

interface ModelCardProps {
  model: AIModel;
  isSelected: boolean;
  isComparing: boolean;
  onSelect: () => void;
  onToggleCompare: () => void;
}

const badgeVariants = {
  'Featured': 'emerald',
  'Realtime': 'blue',
  'Best Quality': 'amber',
  'Low-cost': 'secondary',
  'High-quality': 'amber',
} as const;

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  isSelected,
  isComparing,
  onSelect,
  onToggleCompare,
}) => {
  return (
    <motion.div
      layout
      onClick={onSelect}
      className={`glass-card p-4 cursor-pointer transition-all group ${
        isSelected ? 'border-accent-emerald/50 bg-accent-emerald/5' : 'hover:border-white/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-text-primary truncate group-hover:text-accent-emerald transition-colors">
            {model.name}
          </h3>
          <p className="text-xs text-text-secondary line-clamp-1 mt-0.5">{model.tagline}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCompare();
          }}
          className={`shrink-0 w-6 h-6 rounded-md border transition-all flex items-center justify-center ${
            isComparing
              ? 'bg-accent-blue border-accent-blue text-white'
              : 'border-white/20 text-text-secondary hover:border-accent-blue hover:text-accent-blue'
          }`}
          title={isComparing ? 'Remove from comparison' : 'Add to comparison'}
        >
          {isComparing && <Check size={14} />}
        </button>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {model.badges.slice(0, 3).map((badge) => (
          <Badge
            key={badge}
            variant={badgeVariants[badge as keyof typeof badgeVariants] || 'secondary'}
          >
            {badge}
          </Badge>
        ))}
      </div>

      {/* Quick Metrics */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-text-secondary">
          <DollarSign size={12} className="text-accent-emerald" />
          <span className="font-mono">${model.costPerMin.min.toFixed(2)}/min</span>
        </div>
        <div className="flex items-center gap-1.5 text-text-secondary">
          <Clock size={12} className="text-accent-blue" />
          <span className="font-mono">{model.latencyP50}ms</span>
        </div>
        <div className="flex items-center gap-1.5 text-text-secondary">
          <Server size={12} className="text-accent-amber" />
          <span className="font-mono">{model.gatewayCount}</span>
        </div>
      </div>
    </motion.div>
  );
};

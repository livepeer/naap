import React from 'react';
import { motion } from 'framer-motion';
import { Zap, Check, Cpu, MapPin } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { NetworkModel } from '@naap/types';

interface ModelCardProps {
  model: NetworkModel;
  isSelected: boolean;
  isComparing: boolean;
  onSelect: () => void;
  onToggleCompare: () => void;
}

/** Shorten "NVIDIA GeForce RTX 5090" → "RTX 5090" */
function shortGPUName(name: string): string {
  return name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '');
}

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  isSelected,
  isComparing,
  onSelect,
  onToggleCompare,
}) => {
  const uniqueGPUs = [...new Set(model.gpuHardware.map((g) => shortGPUName(g.name)))];
  const gpuLabel =
    uniqueGPUs.length <= 2
      ? uniqueGPUs.join(' · ')
      : `${uniqueGPUs.slice(0, 2).join(' · ')} +${uniqueGPUs.length - 2}`;

  const slaPercent =
    model.slaScore != null ? `${Math.round(model.slaScore * 100)}%` : null;

  return (
    <motion.div
      layout
      onClick={onSelect}
      className={`glass-card p-4 cursor-pointer transition-all group ${
        isSelected ? 'border-accent-emerald/50 bg-accent-emerald/5' : 'hover:border-white/20'
      }`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-text-primary truncate group-hover:text-accent-emerald transition-colors">
            {model.displayName}
          </h3>
          <div className="flex items-center gap-1.5 mt-1">
            <Badge variant="secondary">{model.pipelineType}</Badge>
            {model.isRealtime && <Badge variant="blue">Realtime</Badge>}
          </div>
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

      {/* GPU line */}
      {uniqueGPUs.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-text-secondary mb-3">
          <Cpu size={12} className="text-accent-amber shrink-0" />
          <span className="truncate">{gpuLabel}</span>
        </div>
      )}

      {/* Metrics row */}
      <div className="flex items-center gap-3 text-xs text-text-secondary flex-wrap">
        {model.avgFPS > 0 && (
          <span className="flex items-center gap-1">
            <Zap size={12} className="text-accent-emerald" />
            <span className="font-mono">{model.avgFPS} fps</span>
          </span>
        )}
        {model.e2eLatencyMs != null && (
          <span className="font-mono text-text-secondary">{model.e2eLatencyMs}ms</span>
        )}
        {slaPercent && (
          <span className="text-accent-emerald font-medium">{slaPercent} SLA</span>
        )}
        {model.regionCodes.length > 0 && (
          <span className="flex items-center gap-1 ml-auto">
            <MapPin size={12} className="text-text-secondary/60" />
            <span className="font-mono">{model.regionCodes.join(' ')}</span>
          </span>
        )}
      </div>
    </motion.div>
  );
};

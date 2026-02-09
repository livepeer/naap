import React from 'react';
import { motion } from 'framer-motion';
import { X, Clock, Zap, Play, Target, Key } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { AIModel, GatewayOffer } from '@naap/types';
import { GatewayOfferCard } from './GatewayOfferCard';

interface ModelDetailPanelProps {
  model: AIModel;
  gatewayOffers: GatewayOffer[];
  onClose: () => void;
  onCreateKey: (model: AIModel, gateway: GatewayOffer) => void;
}

const typeLabels = {
  'text-to-video': 'Text to Video',
  'image-to-video': 'Image to Video',
  'video-to-video': 'Video to Video',
};

const badgeVariants = {
  'Featured': 'emerald',
  'Realtime': 'blue',
  'Best Quality': 'amber',
  'Low-cost': 'secondary',
  'High-quality': 'amber',
} as const;

export const ModelDetailPanel: React.FC<ModelDetailPanelProps> = ({
  model,
  gatewayOffers,
  onClose,
  onCreateKey,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary">{typeLabels[model.type]}</Badge>
            {model.realtime && <Badge variant="blue">Realtime</Badge>}
          </div>
          <h2 className="text-2xl font-bold text-text-primary">{model.name}</h2>
          <p className="text-text-secondary mt-1">{model.tagline}</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/5 rounded-lg transition-colors"
        >
          <X size={20} className="text-text-secondary" />
        </button>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 mb-6">
        {model.badges.map((badge) => (
          <Badge
            key={badge}
            variant={badgeVariants[badge as keyof typeof badgeVariants] || 'secondary'}
          >
            {badge}
          </Badge>
        ))}
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-bg-tertiary/50 rounded-xl">
          <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
            <Clock size={14} />
            <span>P50 Latency</span>
          </div>
          <p className="text-xl font-mono font-bold text-text-primary">{model.latencyP50}ms</p>
        </div>
        <div className="p-4 bg-bg-tertiary/50 rounded-xl">
          <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
            <Zap size={14} />
            <span>Cold Start</span>
          </div>
          <p className="text-xl font-mono font-bold text-text-primary">{(model.coldStart / 1000).toFixed(1)}s</p>
        </div>
        <div className="p-4 bg-bg-tertiary/50 rounded-xl">
          <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
            <Play size={14} />
            <span>Output FPS</span>
          </div>
          <p className="text-xl font-mono font-bold text-text-primary">{model.fps} fps</p>
        </div>
        <div className="p-4 bg-bg-tertiary/50 rounded-xl">
          <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
            <Target size={14} />
            <span>Cost Range</span>
          </div>
          <p className="text-xl font-mono font-bold text-accent-emerald">
            ${model.costPerMin.min.toFixed(2)} - ${model.costPerMin.max.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Use Cases */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest mb-3">
          Supported Use Cases
        </h3>
        <div className="flex flex-wrap gap-2">
          {model.useCases.map((useCase) => (
            <span
              key={useCase}
              className="px-3 py-1.5 bg-bg-tertiary text-text-primary text-sm rounded-lg"
            >
              {useCase}
            </span>
          ))}
        </div>
      </div>

      {/* Gateway Offers */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest mb-3">
          Gateways Offering This Model ({gatewayOffers.length})
        </h3>
        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
          {gatewayOffers.map((offer) => (
            <GatewayOfferCard
              key={offer.gatewayId}
              offer={offer}
              onSelect={() => onCreateKey(model, offer)}
            />
          ))}
          {gatewayOffers.length === 0 && (
            <div className="text-center py-8 text-text-secondary">
              No gateways currently offer this model
            </div>
          )}
        </div>
      </div>

      {/* CTA */}
      {gatewayOffers.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <button
            onClick={() => onCreateKey(model, gatewayOffers[0])}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold hover:bg-accent-emerald/90 transition-all"
          >
            <Key size={18} />
            Create API Key for {model.name}
          </button>
        </div>
      )}
    </motion.div>
  );
};

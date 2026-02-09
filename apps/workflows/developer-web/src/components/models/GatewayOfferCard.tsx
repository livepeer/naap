import React from 'react';
import { Globe, Shield, Clock, TrendingUp, ChevronRight } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { GatewayOffer, SLATier, CapacityLevel } from '@naap/types';

interface GatewayOfferCardProps {
  offer: GatewayOffer;
  onSelect: () => void;
}

const slaTierConfig: Record<SLATier, { label: string; variant: 'emerald' | 'blue' | 'amber' }> = {
  gold: { label: 'Gold SLA', variant: 'emerald' },
  silver: { label: 'Silver SLA', variant: 'blue' },
  bronze: { label: 'Bronze SLA', variant: 'amber' },
};

const capacityConfig: Record<CapacityLevel, { label: string; color: string }> = {
  high: { label: 'High', color: 'text-accent-emerald' },
  medium: { label: 'Medium', color: 'text-accent-amber' },
  low: { label: 'Low', color: 'text-accent-rose' },
};

export const GatewayOfferCard: React.FC<GatewayOfferCardProps> = ({ offer, onSelect }) => {
  const sla = slaTierConfig[offer.slaTier];
  const capacity = capacityConfig[offer.capacity];

  return (
    <div className="p-4 bg-bg-tertiary/50 rounded-xl hover:bg-bg-tertiary transition-all group">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h4 className="font-medium text-text-primary group-hover:text-accent-emerald transition-colors">
            {offer.gatewayName}
          </h4>
          <Badge variant={sla.variant} className="mt-1">
            {sla.label}
          </Badge>
        </div>
        <button
          onClick={onSelect}
          className="flex items-center gap-1 px-3 py-1.5 bg-accent-emerald text-white text-xs font-bold rounded-lg hover:bg-accent-emerald/90 transition-all"
        >
          Select
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-center gap-2 text-text-secondary">
          <Shield size={12} className="text-accent-blue" />
          <span>{offer.uptimeGuarantee}% uptime</span>
        </div>
        <div className="flex items-center gap-2 text-text-secondary">
          <Clock size={12} className="text-accent-amber" />
          <span>{offer.latencyGuarantee}ms max</span>
        </div>
        <div className="flex items-center gap-2 text-text-secondary">
          <Globe size={12} />
          <span>{offer.regions.join(', ')}</span>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp size={12} className={capacity.color} />
          <span className={capacity.color}>{capacity.label} capacity</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
        <span className="text-text-secondary text-xs">Unit price</span>
        <span className="font-mono font-bold text-text-primary">${offer.unitPrice.toFixed(3)}/min</span>
      </div>
    </div>
  );
};

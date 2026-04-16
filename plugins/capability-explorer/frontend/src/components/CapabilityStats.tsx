import React from 'react';
import type { ExplorerStats } from '../lib/types';
import { Layers, Cpu, Server, DollarSign } from 'lucide-react';

interface CapabilityStatsProps {
  stats: ExplorerStats | null;
  loading: boolean;
}

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string | number }> = ({ icon, label, value }) => (
  <div className="glass-card p-4 flex items-center gap-3">
    <div className="p-2 rounded-lg bg-accent-emerald/10 text-accent-emerald">
      {icon}
    </div>
    <div>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="text-lg font-semibold text-text-primary">{value}</p>
    </div>
  </div>
);

export const CapabilityStats: React.FC<CapabilityStatsProps> = ({ stats, loading }) => {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="glass-card p-4 animate-pulse">
            <div className="h-4 bg-bg-tertiary rounded w-20 mb-2" />
            <div className="h-6 bg-bg-tertiary rounded w-12" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6" data-testid="stats-bar">
      <StatCard icon={<Layers size={18} />} label="Capabilities" value={stats.totalCapabilities} />
      <StatCard icon={<Cpu size={18} />} label="GPUs" value={stats.totalGpus} />
      <StatCard icon={<Server size={18} />} label="Orchestrators" value={stats.totalOrchestrators} />
      <StatCard
        icon={<DollarSign size={18} />}
        label="Avg Price"
        value={stats.avgPriceUsd !== null ? `$${stats.avgPriceUsd.toFixed(4)}/min` : 'N/A'}
      />
    </div>
  );
};

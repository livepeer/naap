import React from 'react';
import { Cpu, TrendingUp, User, DollarSign, Layers } from 'lucide-react';
import type { SummaryData } from '../types';

interface SummaryPanelProps {
  summary: SummaryData;
}

export const SummaryPanel: React.FC<SummaryPanelProps> = ({ summary }) => {
  const stats = [
    {
      icon: <Layers size={16} />,
      label: 'Active Requests',
      value: summary.totalRequests.toString(),
      accent: 'text-accent-blue',
      bg: 'bg-accent-blue/10',
    },
    {
      icon: <Cpu size={16} />,
      label: 'GPUs Needed',
      value: summary.totalGPUsNeeded.toString(),
      accent: 'text-accent-emerald',
      bg: 'bg-accent-emerald/10',
    },
    {
      icon: <TrendingUp size={16} />,
      label: 'Top GPU',
      value: summary.mostDesiredGPU ? `${summary.mostDesiredGPU.model}` : '-',
      sub: summary.mostDesiredGPU ? `${summary.mostDesiredGPU.count} units` : undefined,
      accent: 'text-accent-amber',
      bg: 'bg-accent-amber/10',
    },
    {
      icon: <Cpu size={16} />,
      label: 'Top Pipeline',
      value: summary.mostPopularPipeline?.name || '-',
      sub: summary.mostPopularPipeline ? `${summary.mostPopularPipeline.count} requests` : undefined,
      accent: 'text-accent-blue',
      bg: 'bg-accent-blue/10',
    },
    {
      icon: <User size={16} />,
      label: 'Top Requestor',
      value: summary.topRequestor?.name.split(' - ')[0] || '-',
      sub: summary.topRequestor ? `${summary.topRequestor.count} requests` : undefined,
      accent: 'text-accent-emerald',
      bg: 'bg-accent-emerald/10',
    },
    {
      icon: <DollarSign size={16} />,
      label: 'Avg Rate',
      value: summary.avgHourlyRate > 0 ? `$${summary.avgHourlyRate.toFixed(2)}/hr` : '-',
      accent: 'text-accent-amber',
      bg: 'bg-accent-amber/10',
    },
  ];

  return (
    <div className="glass-card p-4">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
        Market Summary
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-start gap-2.5">
            <div className={`p-1.5 rounded-lg ${stat.bg} ${stat.accent} flex-shrink-0 mt-0.5`}>
              {stat.icon}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-text-secondary uppercase tracking-wider">{stat.label}</div>
              <div className={`text-sm font-bold ${stat.accent} truncate`}>{stat.value}</div>
              {stat.sub && <div className="text-[10px] text-text-secondary">{stat.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

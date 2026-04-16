import React from 'react';
import { Cpu, Clock, DollarSign } from 'lucide-react';

interface MetricsBadgeProps {
  gpuCount: number;
  avgLatencyMs: number | null;
  meanPriceUsd: number | null;
}

export const MetricsBadge: React.FC<MetricsBadgeProps> = ({ gpuCount, avgLatencyMs, meanPriceUsd }) => (
  <div className="flex items-center gap-3 text-xs text-text-secondary">
    <span className="flex items-center gap-1" title="GPU count">
      <Cpu size={12} />
      {gpuCount}
    </span>
    {avgLatencyMs != null && Number.isFinite(avgLatencyMs) && (
      <span className="flex items-center gap-1" title="Avg latency">
        <Clock size={12} />
        {avgLatencyMs.toFixed(0)}ms
      </span>
    )}
    {meanPriceUsd != null && Number.isFinite(meanPriceUsd) && (
      <span className="flex items-center gap-1" title="Mean price">
        <DollarSign size={12} />
        ${meanPriceUsd.toFixed(4)}/min
      </span>
    )}
  </div>
);

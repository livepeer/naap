import React, { useEffect, useState } from 'react';

const API_BASE = '/api/v1/deployment-manager';

interface CostEstimate {
  gpuCostPerHour: number;
  totalCostPerHour: number;
  totalCostPerDay: number;
  totalCostPerMonth: number;
  currency: string;
  breakdown: { gpu: number; storage: number; network: number };
  providerSlug: string;
  gpuModel: string;
  gpuCount: number;
}

interface CostPreviewProps {
  providerSlug: string | null;
  gpuModel: string | null;
  gpuCount: number;
}

export const CostPreview: React.FC<CostPreviewProps> = ({ providerSlug, gpuModel, gpuCount }) => {
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!providerSlug || !gpuModel) { setEstimate(null); return; }
    setLoading(true);
    fetch(`${API_BASE}/cost/estimate?provider=${providerSlug}&gpu=${encodeURIComponent(gpuModel)}&count=${gpuCount}`)
      .then(res => res.json())
      .then(data => { if (data.success) setEstimate(data.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [providerSlug, gpuModel, gpuCount]);

  if (!providerSlug || !gpuModel) return null;

  if (providerSlug === 'ssh-bridge') {
    return (
      <div className="p-4 bg-green-50 rounded-lg border border-green-200 mt-4">
        <div className="font-semibold text-[0.95rem] text-green-800">Self-hosted</div>
        <div className="text-[0.8rem] text-green-700 mt-1">
          No GPU rental charges — uses your own hardware via SSH Bridge.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 bg-muted/50 rounded-lg mt-4">
        <span className="text-muted-foreground text-sm">Estimating cost...</span>
      </div>
    );
  }

  if (!estimate) return null;

  const costColor = estimate.totalCostPerHour < 1 ? '#166534' : estimate.totalCostPerHour < 3 ? '#a16207' : '#dc2626';
  const bgClass = estimate.totalCostPerHour < 1 ? 'bg-green-50' : estimate.totalCostPerHour < 3 ? 'bg-amber-50' : 'bg-red-50';
  const borderClass = estimate.totalCostPerHour < 1 ? 'border-green-200' : estimate.totalCostPerHour < 3 ? 'border-amber-200' : 'border-red-200';

  return (
    <div className={`p-4 rounded-lg border mt-4 ${bgClass} ${borderClass}`}>
      <div className="flex justify-between items-baseline">
        <div>
          <span className="font-bold text-xl" style={{ color: costColor }}>
            ${estimate.totalCostPerHour.toFixed(2)}
          </span>
          <span className="text-[0.8rem] text-muted-foreground">/hour</span>
        </div>
        <div className="text-right text-[0.8rem] text-muted-foreground">
          <div>${estimate.totalCostPerDay.toFixed(2)}/day</div>
          <div>${estimate.totalCostPerMonth.toFixed(0)}/month</div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground/70 mt-2 flex gap-4">
        <span>GPU: ${estimate.breakdown.gpu.toFixed(2)}</span>
        {estimate.breakdown.storage > 0 && <span>Storage: ${estimate.breakdown.storage.toFixed(2)}</span>}
      </div>
    </div>
  );
};

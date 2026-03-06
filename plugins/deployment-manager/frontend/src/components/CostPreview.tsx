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
      <div style={{ padding: '1rem', background: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0', marginTop: '1rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#166534' }}>Self-hosted</div>
        <div style={{ fontSize: '0.8rem', color: '#15803d', marginTop: '0.25rem' }}>
          No GPU rental charges — uses your own hardware via SSH Bridge.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '1rem', background: 'var(--dm-bg-secondary)', borderRadius: '0.5rem', marginTop: '1rem' }}>
        <span style={{ color: 'var(--dm-text-secondary)', fontSize: '0.875rem' }}>Estimating cost...</span>
      </div>
    );
  }

  if (!estimate) return null;

  const costColor = estimate.totalCostPerHour < 1 ? '#166534' : estimate.totalCostPerHour < 3 ? '#a16207' : '#dc2626';
  const bgColor = estimate.totalCostPerHour < 1 ? '#f0fdf4' : estimate.totalCostPerHour < 3 ? '#fffbeb' : '#fef2f2';
  const borderColor = estimate.totalCostPerHour < 1 ? '#bbf7d0' : estimate.totalCostPerHour < 3 ? '#fde68a' : '#fecaca';

  return (
    <div style={{ padding: '1rem', background: bgColor, borderRadius: '0.5rem', border: `1px solid ${borderColor}`, marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: '1.25rem', color: costColor }}>
            ${estimate.totalCostPerHour.toFixed(2)}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--dm-text-secondary)' }}>/hour</span>
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--dm-text-secondary)' }}>
          <div>${estimate.totalCostPerDay.toFixed(2)}/day</div>
          <div>${estimate.totalCostPerMonth.toFixed(0)}/month</div>
        </div>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--dm-text-tertiary)', marginTop: '0.5rem', display: 'flex', gap: '1rem' }}>
        <span>GPU: ${estimate.breakdown.gpu.toFixed(2)}</span>
        {estimate.breakdown.storage > 0 && <span>Storage: ${estimate.breakdown.storage.toFixed(2)}</span>}
      </div>
    </div>
  );
};

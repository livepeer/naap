import React from 'react';
import type { GpuOption } from '../hooks/useProviders';

interface GpuConfigFormProps {
  gpuOptions: GpuOption[];
  selectedGpu: string | null;
  gpuCount: number;
  onSelectGpu: (gpuId: string) => void;
  onGpuCountChange: (count: number) => void;
}

export const GpuConfigForm: React.FC<GpuConfigFormProps> = ({
  gpuOptions,
  selectedGpu,
  gpuCount,
  onSelectGpu,
  onGpuCountChange,
}) => {
  return (
    <div>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>GPU Configuration</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
        {gpuOptions.filter((g) => g.available).map((gpu) => (
          <button
            key={gpu.id}
            onClick={() => onSelectGpu(gpu.id)}
            style={{
              padding: '1rem',
              border: selectedGpu === gpu.id ? '2px solid #3b82f6' : '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              background: selectedGpu === gpu.id ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{gpu.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
              {gpu.vramGb}GB VRAM
              {gpu.pricePerHour != null && ` · $${gpu.pricePerHour.toFixed(2)}/hr`}
            </div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: '1rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>GPU Count</label>
        <select
          value={gpuCount}
          onChange={(e) => onGpuCountChange(parseInt(e.target.value, 10))}
          style={{
            marginLeft: '0.75rem',
            padding: '0.375rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
          }}
        >
          {[1, 2, 4, 8].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

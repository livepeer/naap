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
      <h3 className="text-sm font-medium mb-3 text-foreground">GPU Configuration</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {gpuOptions.filter((g) => g.available).map((gpu) => (
          <button
            key={gpu.id}
            onClick={() => onSelectGpu(gpu.id)}
            className={`p-4 rounded-lg text-foreground cursor-pointer text-left transition-all ${
              selectedGpu === gpu.id
                ? 'border-2 border-foreground bg-secondary'
                : 'border border-border bg-card hover:border-muted-foreground/30'
            }`}
          >
            <div className="font-medium text-sm text-foreground">{gpu.name}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {gpu.vramGb}GB VRAM
              {gpu.pricePerHour != null && ` \u00b7 $${gpu.pricePerHour.toFixed(2)}/hr`}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <label className="text-xs font-medium text-muted-foreground">GPU Count</label>
        <select
          value={gpuCount}
          onChange={(e) => onGpuCountChange(parseInt(e.target.value, 10))}
          className="h-8 px-3 border border-border rounded-md text-sm text-foreground bg-background"
        >
          {[1, 2, 4, 8].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

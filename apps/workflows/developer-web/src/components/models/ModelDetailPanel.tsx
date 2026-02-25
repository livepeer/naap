import React from 'react';
import { motion } from 'framer-motion';
import { X, Zap, Target, Activity, Cpu, MapPin, Key } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { NetworkModel } from '@naap/types';

interface ModelDetailPanelProps {
  model: NetworkModel;
  onClose: () => void;
  onCreateKey: () => void;
}

/** Shorten "NVIDIA GeForce RTX 5090" → "RTX 5090" */
function shortGPUName(name: string): string {
  return name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '');
}

export const ModelDetailPanel: React.FC<ModelDetailPanelProps> = ({
  model,
  onClose,
  onCreateKey,
}: ModelDetailPanelProps) => {
  const slaPercent = model.slaScore != null ? `${(model.slaScore * 100).toFixed(1)}%` : '—';

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary">{model.pipelineType}</Badge>
            {model.isRealtime && <Badge variant="blue">Realtime</Badge>}
          </div>
          <h2 className="text-2xl font-bold text-text-primary">{model.displayName}</h2>
          <p className="text-text-secondary text-sm mt-1 font-mono">{model.modelId}</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/5 rounded-lg transition-colors"
        >
          <X size={20} className="text-text-secondary" />
        </button>
      </div>

      {/* Performance metrics (2×2 grid) */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="p-3 bg-bg-tertiary/50 rounded-xl">
          <div className="flex items-center gap-1.5 text-text-secondary text-xs mb-1">
            <Zap size={13} />
            <span>Avg FPS</span>
          </div>
          <p className="text-xl font-mono font-bold text-text-primary">
            {model.avgFPS > 0 ? `${model.avgFPS}` : '—'}
          </p>
        </div>
        <div className="p-3 bg-bg-tertiary/50 rounded-xl">
          <div className="flex items-center gap-1.5 text-text-secondary text-xs mb-1">
            <Activity size={13} />
            <span>E2E Latency</span>
          </div>
          <p className="text-xl font-mono font-bold text-text-primary">
            {model.e2eLatencyMs != null ? `${model.e2eLatencyMs}ms` : '—'}
          </p>
        </div>
        <div className="p-3 bg-bg-tertiary/50 rounded-xl">
          <div className="flex items-center gap-1.5 text-text-secondary text-xs mb-1">
            <Target size={13} />
            <span>SLA Score</span>
          </div>
          <p className={`text-xl font-mono font-bold ${model.slaScore != null ? 'text-accent-emerald' : 'text-text-primary'}`}>
            {slaPercent}
          </p>
        </div>
        <div className="p-3 bg-bg-tertiary/50 rounded-xl">
          <div className="flex items-center gap-1.5 text-text-secondary text-xs mb-1">
            <Cpu size={13} />
            <span>Orchestrators</span>
          </div>
          <p className="text-xl font-mono font-bold text-text-primary">
            {model.orchestratorCount > 0 ? model.orchestratorCount : '—'}
          </p>
        </div>
      </div>

      {/* GPU Fleet */}
      {model.gpuHardware.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
            GPU Fleet
          </h3>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-secondary border-b border-white/10 bg-bg-tertiary/40">
                  <th className="text-left px-3 py-2">GPU</th>
                  <th className="text-right px-3 py-2">VRAM</th>
                  <th className="text-right px-3 py-2">Count</th>
                  <th className="text-right px-3 py-2">Avg FPS</th>
                  <th className="text-right px-3 py-2">Failure</th>
                </tr>
              </thead>
              <tbody>
                {model.gpuHardware.map((gpu) => (
                  <tr key={gpu.name} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2 font-medium text-text-primary">
                      {shortGPUName(gpu.name)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text-secondary">
                      {gpu.memoryGB > 0 ? `${gpu.memoryGB} GB` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text-secondary">
                      {gpu.count}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text-secondary">
                      {gpu.avgFPS > 0 ? `${gpu.avgFPS}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${gpu.failureRate > 0.05 ? 'text-accent-rose' : 'text-text-secondary'}`}>
                      {(gpu.failureRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Regions */}
      {model.regions.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
            Available Regions
          </h3>
          <div className="flex flex-wrap gap-2">
            {model.regions.map((region) => (
              <span
                key={region}
                className="flex items-center gap-1 px-2.5 py-1 bg-bg-tertiary text-text-primary text-xs rounded-lg"
              >
                <MapPin size={11} className="text-text-secondary/60" />
                {region}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <button
          onClick={onCreateKey}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold hover:bg-accent-emerald/90 transition-all"
        >
          <Key size={18} />
          Create API Key for {model.displayName}
        </button>
      </div>
    </motion.div>
  );
};

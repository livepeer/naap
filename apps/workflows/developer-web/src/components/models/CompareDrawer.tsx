import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronUp } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { NetworkModel } from '@naap/types';

interface CompareDrawerProps {
  models: NetworkModel[];
  onRemove: (modelId: string) => void;
  onClear: () => void;
  onSelect: (model: NetworkModel) => void;
}

/** Shorten "NVIDIA GeForce RTX 5090" → "RTX 5090" */
function shortGPUName(name: string): string {
  return name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '');
}

export const CompareDrawer: React.FC<CompareDrawerProps> = ({
  models,
  onRemove,
  onClear,
  onSelect,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(true);

  if (models.length === 0) return null;

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed bottom-0 left-0 right-0 bg-bg-secondary border-t border-white/10 z-50 shadow-2xl"
    >
      {/* Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-6 py-3 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-bold text-text-primary">
            Comparing {models.length} Models
          </span>
          <Badge variant="blue">{models.length}/4</Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="text-text-secondary text-sm hover:text-text-primary transition-colors"
          >
            Clear all
          </button>
          <ChevronUp
            size={20}
            className={`text-text-secondary transition-transform ${isExpanded ? '' : 'rotate-180'}`}
          />
        </div>
      </div>

      {/* Comparison Table */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6 overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs text-text-secondary uppercase tracking-widest">
                    <th className="pb-3 pr-4 w-48">Model</th>
                    <th className="pb-3 px-4">Pipeline</th>
                    <th className="pb-3 px-4">Avg FPS</th>
                    <th className="pb-3 px-4">E2E Latency</th>
                    <th className="pb-3 px-4">SLA Score</th>
                    <th className="pb-3 px-4">GPU Hardware</th>
                    <th className="pb-3 px-4">Regions</th>
                    <th className="pb-3 pl-4 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => {
                    const uniqueGPUs = [...new Set(model.gpuHardware.map((g) => shortGPUName(g.name)))];
                    return (
                      <tr
                        key={model.id}
                        className="border-t border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                        onClick={() => onSelect(model)}
                      >
                        <td className="py-3 pr-4">
                          <span className="font-medium text-text-primary">{model.displayName}</span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="secondary">{model.pipelineType}</Badge>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono text-text-primary">
                            {model.avgFPS > 0 ? `${model.avgFPS}` : '—'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono text-text-primary">
                            {model.e2eLatencyMs != null ? `${model.e2eLatencyMs}ms` : '—'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`font-mono ${model.slaScore != null ? 'text-accent-emerald' : 'text-text-primary'}`}>
                            {model.slaScore != null ? `${(model.slaScore * 100).toFixed(1)}%` : '—'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-text-secondary text-xs">
                            {uniqueGPUs.length > 0 ? uniqueGPUs.join(', ') : '—'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono text-text-secondary text-xs">
                            {model.regionCodes.join(' ') || '—'}
                          </span>
                        </td>
                        <td className="py-3 pl-4">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemove(model.id);
                            }}
                            className="p-1.5 hover:bg-white/10 rounded transition-colors"
                          >
                            <X size={16} className="text-text-secondary" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Recommendations */}
              <div className="mt-4 pt-4 border-t border-white/5">
                <h4 className="text-xs text-text-secondary uppercase tracking-widest mb-2">
                  Recommendations
                </h4>
                <div className="flex flex-wrap gap-4 text-sm">
                  {models.some((m) => m.isRealtime) && (
                    <span className="text-text-secondary">
                      <span className="text-accent-blue font-medium">For real-time: </span>
                      {models.filter((m) => m.isRealtime).map((m) => m.displayName).join(', ')}
                    </span>
                  )}
                  {models.length > 1 && models.some((m) => m.e2eLatencyMs != null) && (
                    <span className="text-text-secondary">
                      <span className="text-accent-amber font-medium">Fastest: </span>
                      {models
                        .filter((m) => m.e2eLatencyMs != null)
                        .reduce((a, b) => (a.e2eLatencyMs! < b.e2eLatencyMs! ? a : b))
                        .displayName}
                    </span>
                  )}
                  {models.length > 1 && models.some((m) => m.slaScore != null) && (
                    <span className="text-text-secondary">
                      <span className="text-accent-emerald font-medium">Best SLA: </span>
                      {models
                        .filter((m) => m.slaScore != null)
                        .reduce((a, b) => (a.slaScore! > b.slaScore! ? a : b))
                        .displayName}
                    </span>
                  )}
                  {models.length > 1 && (
                    <span className="text-text-secondary">
                      <span className="text-accent-emerald font-medium">Widest coverage: </span>
                      {models.reduce((a, b) =>
                        a.regionCodes.length >= b.regionCodes.length ? a : b
                      ).displayName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

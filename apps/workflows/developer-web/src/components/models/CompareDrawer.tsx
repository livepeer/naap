import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, ChevronUp } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { AIModel } from '@naap/types';

interface CompareDrawerProps {
  models: AIModel[];
  onRemove: (modelId: string) => void;
  onClear: () => void;
  onSelect: (model: AIModel) => void;
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
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="text-left text-xs text-text-secondary uppercase tracking-widest">
                    <th className="pb-3 pr-4 w-40">Model</th>
                    <th className="pb-3 px-4">Type</th>
                    <th className="pb-3 px-4">Cost/min</th>
                    <th className="pb-3 px-4">P50 Latency</th>
                    <th className="pb-3 px-4">Cold Start</th>
                    <th className="pb-3 px-4">FPS</th>
                    <th className="pb-3 px-4">Gateways</th>
                    <th className="pb-3 pl-4 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr
                      key={model.id}
                      className="border-t border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                      onClick={() => onSelect(model)}
                    >
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          {model.featured && (
                            <Star size={14} className="text-accent-amber fill-accent-amber" />
                          )}
                          <span className="font-medium text-text-primary">{model.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="secondary">{model.type}</Badge>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-accent-emerald">
                          ${model.costPerMin.min.toFixed(2)} - ${model.costPerMin.max.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-text-primary">{model.latencyP50}ms</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-text-primary">
                          {(model.coldStart / 1000).toFixed(1)}s
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-text-primary">{model.fps}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-text-primary">{model.gatewayCount}</span>
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
                  ))}
                </tbody>
              </table>

              {/* Best For Notes */}
              <div className="mt-4 pt-4 border-t border-white/5">
                <h4 className="text-xs text-text-secondary uppercase tracking-widest mb-2">
                  Recommendations
                </h4>
                <div className="flex flex-wrap gap-3 text-sm">
                  {models.some((m) => m.realtime) && (
                    <span className="text-text-secondary">
                      <span className="text-accent-blue font-medium">For real-time:</span>{' '}
                      {models.filter((m) => m.realtime).map((m) => m.name).join(', ')}
                    </span>
                  )}
                  {models.length > 1 && (
                    <span className="text-text-secondary">
                      <span className="text-accent-emerald font-medium">Lowest cost:</span>{' '}
                      {models.reduce((a, b) => (a.costPerMin.min < b.costPerMin.min ? a : b)).name}
                    </span>
                  )}
                  {models.length > 1 && (
                    <span className="text-text-secondary">
                      <span className="text-accent-amber font-medium">Fastest:</span>{' '}
                      {models.reduce((a, b) => (a.latencyP50 < b.latencyP50 ? a : b)).name}
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

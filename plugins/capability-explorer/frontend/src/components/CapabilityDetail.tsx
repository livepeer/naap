import React from 'react';
import type { EnrichedCapability } from '../lib/types';
import { CategoryBadge } from './CategoryBadge';
import { SnippetViewer } from './SnippetViewer';
import {
  X, ExternalLink, Cpu, Clock, DollarSign, Server, Layers, Shield,
} from 'lucide-react';

interface CapabilityDetailProps {
  capability: EnrichedCapability;
  onClose: () => void;
}

export const CapabilityDetail: React.FC<CapabilityDetailProps> = ({ capability, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="detail-modal"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-bg-primary rounded-2xl border border-[var(--border-color)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 bg-bg-primary border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-text-primary">{capability.name}</h2>
            <CategoryBadge category={capability.category} />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            data-testid="close-detail"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Description */}
          {capability.description && (
            <section>
              <h3 className="text-sm font-medium text-text-secondary mb-2">Description</h3>
              <p className="text-sm text-text-primary leading-relaxed">{capability.description}</p>
            </section>
          )}

          {/* Metadata */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard icon={<Cpu size={16} />} label="GPUs" value={String(capability.gpuCount)} />
            <MetricCard icon={<Server size={16} />} label="Orchestrators" value={String(capability.orchestratorCount)} />
            <MetricCard
              icon={<Clock size={16} />}
              label="Avg Latency"
              value={capability.avgLatencyMs !== null ? `${capability.avgLatencyMs.toFixed(0)}ms` : 'N/A'}
            />
            <MetricCard
              icon={<DollarSign size={16} />}
              label="Mean Price"
              value={capability.meanPriceUsd !== null ? `$${capability.meanPriceUsd.toFixed(4)}` : 'N/A'}
            />
          </section>

          {/* Details grid */}
          <section className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <DetailRow label="Source" value={capability.source} />
            <DetailRow label="Version" value={capability.version} />
            <DetailRow label="Price Unit" value={capability.priceUnit} />
            <DetailRow label="Capacity" value={String(capability.totalCapacity)} />
            {capability.license && <DetailRow label="License" value={capability.license} icon={<Shield size={12} />} />}
          </section>

          {/* Links */}
          {capability.modelSourceUrl && (
            <section>
              <a
                href={capability.modelSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-accent-emerald hover:underline"
              >
                <ExternalLink size={14} />
                View on HuggingFace
              </a>
            </section>
          )}

          {/* Models table */}
          {capability.models.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-text-secondary mb-2">
                Models ({capability.models.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="models-table">
                  <thead>
                    <tr className="text-left text-text-secondary border-b border-[var(--border-color)]">
                      <th className="pb-2 font-medium">Model ID</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">GPUs</th>
                      <th className="pb-2 font-medium">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capability.models.map((model) => (
                      <tr key={model.modelId} className="border-b border-[var(--border-color)]/50">
                        <td className="py-2 text-text-primary font-mono text-xs">
                          {model.huggingFaceUrl ? (
                            <a href={model.huggingFaceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent-emerald">
                              {model.modelId}
                            </a>
                          ) : (
                            model.modelId
                          )}
                        </td>
                        <td className="py-2">
                          <span className={`inline-flex items-center gap-1 text-xs ${model.warm ? 'text-accent-emerald' : 'text-text-muted'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${model.warm ? 'bg-accent-emerald' : 'bg-text-muted'}`} />
                            {model.warm ? 'Warm' : 'Cold'}
                          </span>
                        </td>
                        <td className="py-2 text-text-secondary">{model.gpuCount}</td>
                        <td className="py-2 text-text-secondary">
                          {model.meanPriceUsd !== null ? `$${model.meanPriceUsd.toFixed(4)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* SDK Snippets */}
          <section>
            <h3 className="text-sm font-medium text-text-secondary mb-2">SDK Integration</h3>
            <SnippetViewer snippet={capability.sdkSnippet} />
          </section>

          {/* Tags */}
          {capability.tags.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-text-secondary mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {capability.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-bg-tertiary text-text-secondary border border-[var(--border-color)]">
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

const MetricCard: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="glass-card p-3 flex items-center gap-2">
    <span className="text-accent-emerald">{icon}</span>
    <div>
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-sm font-semibold text-text-primary">{value}</p>
    </div>
  </div>
);

const DetailRow: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="flex items-center justify-between py-1 border-b border-[var(--border-color)]/30">
    <span className="text-text-secondary flex items-center gap-1">
      {icon}
      {label}
    </span>
    <span className="text-text-primary font-medium">{value}</span>
  </div>
);

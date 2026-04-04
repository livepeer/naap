/**
 * AlertConfigModal - Configure alert rules
 */

import React, { useState } from 'react';

interface AlertConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (type: string, orchestratorAddr?: string) => Promise<void>;
  existingAlerts: Array<{ id: string; type: string; orchestratorAddr: string | null; enabled: boolean }>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const ALERT_TYPES = [
  { value: 'reward_cut_change', label: 'Reward Cut Change', description: 'When an orchestrator changes their reward cut' },
  { value: 'missed_reward', label: 'Missed Reward', description: 'When an orchestrator fails to call reward()' },
  { value: 'deactivation', label: 'Deactivation', description: 'When an orchestrator gets deactivated' },
  { value: 'unbonding_ready', label: 'Unbonding Ready', description: 'When your unbonding locks become withdrawable' },
];

export const AlertConfigModal: React.FC<AlertConfigModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  existingAlerts,
  onToggle,
  onDelete,
}) => {
  const [selectedType, setSelectedType] = useState('');
  const [orchestratorAddr, setOrchestratorAddr] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!selectedType) return;
    setIsCreating(true);
    try {
      await onCreate(selectedType, orchestratorAddr || undefined);
      setSelectedType('');
      setOrchestratorAddr('');
    } finally {
      setIsCreating(false);
    }
  };

  const needsOrchestrator = ['reward_cut_change', 'missed_reward', 'deactivation'].includes(selectedType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg bg-bg-secondary rounded-xl border border-white/10 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h3 className="text-lg font-semibold text-text-primary">Alert Configuration</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
          {/* Existing alerts */}
          {existingAlerts.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">Active Alerts</h4>
              <div className="space-y-2">
                {existingAlerts.map(alert => (
                  <div key={alert.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                    <div>
                      <p className="text-sm text-text-primary">{alert.type.replace(/_/g, ' ')}</p>
                      {alert.orchestratorAddr && (
                        <p className="text-xs text-text-muted font-mono">
                          {alert.orchestratorAddr.slice(0, 8)}...{alert.orchestratorAddr.slice(-6)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onToggle(alert.id, !alert.enabled)}
                        className={`text-xs px-2 py-1 rounded ${
                          alert.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-text-muted'
                        }`}
                      >
                        {alert.enabled ? 'On' : 'Off'}
                      </button>
                      <button
                        onClick={() => onDelete(alert.id)}
                        className="text-xs text-rose-400 hover:text-rose-300"
                        aria-label="Delete alert"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New alert form */}
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-2">Add New Alert</h4>
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="w-full p-2 rounded-lg bg-white/5 border border-white/10 text-text-primary text-sm"
            >
              <option value="">Select alert type...</option>
              {ALERT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            {selectedType && (
              <p className="text-xs text-text-muted mt-1">
                {ALERT_TYPES.find(t => t.value === selectedType)?.description}
              </p>
            )}

            {needsOrchestrator && (
              <input
                type="text"
                value={orchestratorAddr}
                onChange={e => setOrchestratorAddr(e.target.value)}
                placeholder="Orchestrator address (0x...)"
                className="w-full mt-2 p-2 rounded-lg bg-white/5 border border-white/10 text-text-primary text-sm font-mono placeholder:text-text-muted"
              />
            )}

            <button
              onClick={handleCreate}
              disabled={!selectedType || isCreating || (needsOrchestrator && !orchestratorAddr)}
              className="mt-3 w-full py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? 'Creating...' : 'Add Alert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

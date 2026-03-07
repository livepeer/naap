/**
 * Watchlist panel component (S15)
 */

import React, { useState } from 'react';
import { Eye, Plus, Trash2, Star } from 'lucide-react';
import { formatAddress, formatBalance } from '../lib/utils';

interface WatchlistEntry {
  id: string;
  orchestratorAddr: string;
  label: string | null;
  notes: string | null;
  addedAt: string;
  orchestrator?: {
    name: string | null;
    rewardCut: number;
    feeShare: number;
    totalStake: string;
    isActive: boolean;
  };
}

interface WatchlistPanelProps {
  items: WatchlistEntry[];
  isLoading?: boolean;
  onAdd: (addr: string, label?: string, notes?: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: { label?: string; notes?: string }) => void;
  onCompare?: (addr: string) => void;
}

export const WatchlistPanel: React.FC<WatchlistPanelProps> = ({
  items,
  isLoading,
  onAdd,
  onRemove,
  onUpdate: _onUpdate,
  onCompare,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAddr, setNewAddr] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const handleAdd = () => {
    if (!newAddr) return;
    onAdd(newAddr, newLabel || undefined);
    setNewAddr('');
    setNewLabel('');
    setShowAddForm(false);
  };

  if (isLoading) {
    return (
      <div className="glass-card p-6 animate-pulse">
        <div className="h-5 bg-bg-tertiary rounded w-32 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-bg-tertiary rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6" role="region" aria-label="Orchestrator watchlist">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-accent-purple" />
          <h3 className="text-sm font-semibold text-text-secondary">Watchlist</h3>
          <span className="text-xs text-text-muted">({items.length})</span>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 text-xs text-accent-purple hover:text-accent-purple/80"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      {showAddForm && (
        <div className="mb-4 p-3 bg-bg-tertiary rounded-lg space-y-2">
          <input
            type="text"
            value={newAddr}
            onChange={e => setNewAddr(e.target.value)}
            placeholder="0x... orchestrator address"
            className="w-full p-2 bg-bg-secondary border border-white/10 rounded text-sm font-mono text-text-primary"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              className="flex-1 p-2 bg-bg-secondary border border-white/10 rounded text-sm text-text-primary"
            />
            <button onClick={handleAdd} className="px-4 py-2 bg-accent-purple text-white rounded text-sm">
              Add
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-4">
          No orchestrators in watchlist. Add candidates you're monitoring.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="p-3 bg-bg-tertiary rounded-lg flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {item.orchestrator?.name || item.label || formatAddress(item.orchestratorAddr)}
                  </p>
                  {item.orchestrator?.isActive === false && (
                    <span className="text-xs text-accent-rose bg-accent-rose/10 px-1 rounded">Inactive</span>
                  )}
                </div>
                <p className="text-xs font-mono text-text-muted">{formatAddress(item.orchestratorAddr, 6)}</p>
                {item.orchestrator && (
                  <div className="flex gap-3 mt-1 text-xs text-text-secondary">
                    <span>Cut: {item.orchestrator.rewardCut}%</span>
                    <span>Fee: {item.orchestrator.feeShare}%</span>
                    <span>Stake: {formatBalance(item.orchestrator.totalStake)} LPT</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 ml-2">
                {onCompare && (
                  <button
                    onClick={() => onCompare(item.orchestratorAddr)}
                    className="p-1.5 text-text-muted hover:text-accent-purple"
                    title="Compare"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => onRemove(item.id)}
                  className="p-1.5 text-text-muted hover:text-accent-rose"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * OrchestratorSelect - Searchable dropdown with orchestrator metrics preview
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { formatAddress, formatBalance } from '../../lib/utils';
import { getApiUrl } from '../../App';

interface Orchestrator {
  address: string;
  name: string | null;
  totalStake: string;
  rewardCut: number;
  feeShare: number;
  isActive: boolean;
}

interface OrchestratorSelectProps {
  value: string;
  onChange: (address: string) => void;
  excludeAddress?: string;
}

export const OrchestratorSelect: React.FC<OrchestratorSelectProps> = ({
  value,
  onChange,
  excludeAddress,
}) => {
  const shell = useShell();
  const [orchestrators, setOrchestrators] = useState<Orchestrator[]>([]);
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const fetchOrchestrators = async () => {
      try {
        const apiUrl = getApiUrl();
        const token = await shell.auth.getToken().catch(() => '');
        const res = await fetch(`${apiUrl}/staking/orchestrators`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const json = await res.json();
        const data = json.data ?? json;
        setOrchestrators(data.orchestrators || []);
      } catch {
        // Silently fail - user can still enter address manually
      }
    };
    fetchOrchestrators();
  }, [shell]);

  const filtered = useMemo(() => {
    return orchestrators
      .filter(o => o.isActive)
      .filter(o => o.address !== excludeAddress)
      .filter(o => {
        if (!search) return true;
        const s = search.toLowerCase();
        return o.address.toLowerCase().includes(s) || (o.name || '').toLowerCase().includes(s);
      })
      .sort((a, b) => parseFloat(b.totalStake || '0') - parseFloat(a.totalStake || '0'));
  }, [orchestrators, search, excludeAddress]);

  const selected = orchestrators.find(o => o.address === value);

  return (
    <div className="relative">
      <div
        className="px-3 py-2 bg-bg-tertiary rounded-lg border border-border-primary cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selected ? (
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm text-text-primary">
              {selected.name || formatAddress(selected.address)}
            </span>
            <span className="text-xs text-text-secondary">
              {(selected.rewardCut / 10000).toFixed(1)}% cut
            </span>
          </div>
        ) : value ? (
          <span className="font-mono text-sm text-text-primary">{formatAddress(value)}</span>
        ) : (
          <span className="text-sm text-text-secondary">Select an orchestrator...</span>
        )}
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary border border-border-primary rounded-lg shadow-lg z-50 max-h-64 overflow-hidden">
          <div className="p-2 border-b border-border-primary">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or address..."
              className="w-full px-2 py-1 bg-bg-tertiary text-text-primary text-sm rounded border-none outline-none"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto max-h-48">
            {filtered.slice(0, 20).map(o => (
              <button
                key={o.address}
                onClick={() => { onChange(o.address); setIsOpen(false); setSearch(''); }}
                className="w-full px-3 py-2 text-left hover:bg-bg-tertiary transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-text-primary">
                    {o.name || formatAddress(o.address)}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {formatBalance(o.totalStake)} LPT
                  </span>
                </div>
                <div className="flex gap-3 mt-0.5">
                  <span className="text-xs text-text-secondary">
                    Cut: {(o.rewardCut / 10000).toFixed(1)}%
                  </span>
                  <span className="text-xs text-text-secondary">
                    Fee: {(o.feeShare / 10000).toFixed(1)}%
                  </span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-text-secondary text-sm">
                No orchestrators found
              </div>
            )}
          </div>
          <div className="p-2 border-t border-border-primary">
            <input
              type="text"
              placeholder="Or paste address: 0x..."
              className="w-full px-2 py-1 bg-bg-tertiary text-text-primary font-mono text-xs rounded border-none outline-none"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const target = e.target as HTMLInputElement;
                  if (/^0x[a-fA-F0-9]{40}$/.test(target.value)) {
                    onChange(target.value);
                    setIsOpen(false);
                  }
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

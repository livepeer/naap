/**
 * Compare Page - Orchestrator comparison (side-by-side)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShell } from '@naap/plugin-sdk';
import { useWallet } from '../context/WalletContext';
import { useCompare } from '../hooks/useCompare';
import { PageHeader } from '../components/PageHeader';
import { ComparisonGrid } from '../components/ComparisonGrid';
import { getApiUrl } from '../App';

interface OrchestratorOption {
  address: string;
  name: string | null;
}

export const ComparePage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected } = useWallet();
  const shell = useShell();
  const { orchestrators, selectedAddresses, addO, removeO, isLoading } = useCompare();
  const [allOrchestrators, setAllOrchestrators] = useState<OrchestratorOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isConnected) navigate('/');
  }, [isConnected, navigate]);

  // Fetch all orchestrators for the search
  const fetchAll = useCallback(async () => {
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/staking/orchestrators?activeOnly=true`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      const data = json.data ?? json;
      setAllOrchestrators((data.orchestrators || []).map((o: { address: string; name: string | null }) => ({
        address: o.address,
        name: o.name,
      })));
    } catch (err) {
      console.error('Failed to fetch orchestrators:', err);
    }
  }, [shell]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = allOrchestrators.filter(o =>
    !selectedAddresses.includes(o.address) &&
    (o.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
     o.address.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compare Orchestrators"
        subtitle="Side-by-side comparison of up to 4 orchestrators"
        onBack={() => navigate('/portfolio')}
      />

      {/* Search + Add */}
      <div className="glass-card p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search orchestrators by name or address..."
              className="w-full p-2.5 pl-9 rounded-lg bg-white/5 border border-white/10 text-text-primary text-sm placeholder:text-text-muted"
            />
            <svg className="absolute left-3 top-3 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {searchQuery && filtered.length > 0 && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
            {filtered.slice(0, 10).map(o => (
              <button
                key={o.address}
                onClick={() => { addO(o.address); setSearchQuery(''); }}
                disabled={selectedAddresses.length >= 4}
                className="w-full flex items-center justify-between p-2.5 hover:bg-white/5 transition-colors text-left disabled:opacity-50"
              >
                <div>
                  <p className="text-sm text-text-primary">{o.name || 'Unknown'}</p>
                  <p className="text-xs font-mono text-text-muted">{o.address.slice(0, 10)}...{o.address.slice(-8)}</p>
                </div>
                <span className="text-xs text-purple-400">Add</span>
              </button>
            ))}
          </div>
        )}

        {selectedAddresses.length >= 4 && (
          <p className="mt-2 text-xs text-amber-400">Maximum 4 orchestrators can be compared</p>
        )}
      </div>

      {/* Comparison grid */}
      <ComparisonGrid
        orchestrators={orchestrators}
        onRemove={removeO}
        isLoading={isLoading}
      />
    </div>
  );
};

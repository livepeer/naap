/**
 * Orchestrators Page (Phase 4c)
 *
 * Rewritten to use live data from livepeer-svc via SDK hooks.
 * Replaces hardcoded mockOrchestrators with useOrchestrators() hook.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Plus, Search, X, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { Card, Badge, VersionBadge } from '@naap/ui';
import { useOrchestrators, useStakingActions } from '@naap/plugin-sdk';
import { useShell } from '@naap/plugin-sdk';

const statusColors = { active: 'emerald', suspended: 'amber', updating: 'blue' } as const;

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatStake(wei: string): string {
  try {
    const eth = parseFloat(wei) / 1e18;
    if (eth >= 1_000_000) return `${(eth / 1_000_000).toFixed(1)}M`;
    if (eth >= 1_000) return `${(eth / 1_000).toFixed(1)}K`;
    return eth.toFixed(2);
  } catch {
    return '0';
  }
}

export const OrchestratorsPage: React.FC = () => {
  const shell = useShell();
  const { data: orchestrators, loading, error, refetch } = useOrchestrators();
  const { bond } = useStakingActions();
  const [selectedOrch, setSelectedOrch] = useState<(typeof orchestrators extends (infer T)[] ? T : never) | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOrchestrators = (orchestrators || []).filter((o) =>
    (o.address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (o.serviceURI || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatus = (o: { active?: boolean; status?: string }): keyof typeof statusColors => {
    if (o.active === true || o.status === 'Registered') return 'active';
    return 'suspended';
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-accent-blue" />
        <p className="text-text-secondary text-sm">Loading orchestrators from Livepeer network...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center px-8">
        <div className="w-16 h-16 rounded-full bg-accent-rose/10 flex items-center justify-center">
          <AlertTriangle size={32} className="text-accent-rose" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-text-primary mb-2">Failed to Load Orchestrators</h3>
          <p className="text-text-secondary text-sm max-w-md">{error.message}</p>
        </div>
        <button onClick={() => refetch()} className="px-4 py-2 bg-accent-blue text-white rounded-lg flex items-center gap-2">
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Orchestrators</h1>
          <p className="text-text-secondary mt-1">
            {filteredOrchestrators.length} GPU compute providers on the Livepeer network
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => refetch()} className="p-3 bg-bg-secondary border border-white/10 rounded-xl hover:bg-bg-tertiary transition-all" title="Refresh">
            <RefreshCw size={18} className="text-text-secondary" />
          </button>
          <button className="flex items-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all">
            <Plus size={18} /> Deploy Orchestrator
          </button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
        <input type="text" placeholder="Search by address or service URI..." value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredOrchestrators.map((orch) => {
          const status = getStatus(orch);
          return (
            <motion.div key={orch.address} layoutId={orch.address} onClick={() => setSelectedOrch(orch)}
              className="glass-card p-6 cursor-pointer hover:border-accent-blue/30 transition-all group">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-accent-blue to-purple-500 flex items-center justify-center">
                    <Cpu size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-text-primary font-mono text-sm">{shortenAddress(orch.address)}</h3>
                    <p className="text-xs text-text-secondary truncate max-w-[180px]">{orch.serviceURI || 'No service URI'}</p>
                  </div>
                </div>
                <Badge variant={statusColors[status]}>{status}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-xs text-text-secondary">Stake</p>
                  <p className="font-mono font-bold text-text-primary">{formatStake(orch.delegatedStake || '0')} LPT</p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Reward Cut</p>
                  <p className="font-mono font-bold text-accent-emerald">{((parseFloat(orch.rewardCut || '0') / 1_000_000) * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Fee Share</p>
                  <p className="font-mono font-bold text-accent-amber">{((parseFloat(orch.feeShare || '0') / 1_000_000) * 100).toFixed(1)}%</p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-white/5">
                <span className="text-sm text-text-secondary font-mono">{shortenAddress(orch.address)}</span>
                {orch.pricePerPixel && <span className="text-xs text-text-secondary">{orch.pricePerPixel} wei/px</span>}
              </div>
            </motion.div>
          );
        })}
      </div>

      {filteredOrchestrators.length === 0 && !loading && (
        <div className="text-center py-16">
          <Cpu size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
          <h3 className="text-lg font-bold text-text-primary mb-2">No orchestrators found</h3>
          <p className="text-text-secondary">Try adjusting your search criteria</p>
        </div>
      )}

      <AnimatePresence>
        {selectedOrch && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={() => setSelectedOrch(null)} />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              className="fixed right-0 top-0 h-full w-[500px] bg-bg-secondary border-l border-white/10 z-50 p-6 overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold font-mono">{shortenAddress(selectedOrch.address)}</h2>
                <button onClick={() => setSelectedOrch(null)} className="p-2 hover:bg-white/5 rounded-lg"><X size={24} /></button>
              </div>
              <div className="space-y-4">
                <Card>
                  <div className="grid grid-cols-2 gap-4">
                    <div><p className="text-xs text-text-secondary">Address</p><p className="font-bold font-mono text-xs break-all">{selectedOrch.address}</p></div>
                    <div><p className="text-xs text-text-secondary">Service URI</p><p className="font-bold text-xs break-all">{selectedOrch.serviceURI || 'N/A'}</p></div>
                    <div><p className="text-xs text-text-secondary">Total Stake</p><p className="font-bold">{formatStake(selectedOrch.delegatedStake || '0')} LPT</p></div>
                    <div><p className="text-xs text-text-secondary">Status</p><p className="font-bold">{selectedOrch.status || (selectedOrch.active ? 'Registered' : 'Not Registered')}</p></div>
                    <div><p className="text-xs text-text-secondary">Reward Cut</p><p className="font-bold">{((parseFloat(selectedOrch.rewardCut || '0') / 1_000_000) * 100).toFixed(2)}%</p></div>
                    <div><p className="text-xs text-text-secondary">Fee Share</p><p className="font-bold">{((parseFloat(selectedOrch.feeShare || '0') / 1_000_000) * 100).toFixed(2)}%</p></div>
                    <div><p className="text-xs text-text-secondary">Activation Round</p><p className="font-bold">{selectedOrch.activationRound || 'N/A'}</p></div>
                    <div><p className="text-xs text-text-secondary">Last Reward Round</p><p className="font-bold">{selectedOrch.lastRewardRound || 'N/A'}</p></div>
                  </div>
                </Card>
                <button
                  onClick={() => {
                    shell.notifications?.info?.('Delegate flow coming soon');
                  }}
                  className="w-full px-4 py-3 bg-accent-blue text-white rounded-xl font-bold hover:bg-accent-blue/90 transition-all"
                >
                  Delegate to this Orchestrator
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrchestratorsPage;

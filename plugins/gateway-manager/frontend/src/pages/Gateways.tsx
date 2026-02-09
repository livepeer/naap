/**
 * Gateways Page (Phase 4d)
 *
 * Rewritten to use live data from livepeer-svc via SDK hooks.
 * Replaces CRUD-only backend calls with useGatewayDeposit() and livepeer-svc endpoints.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Plus, Search, ChevronRight,
  Activity, Globe, Cpu, X, AlertTriangle,
  BarChart3, Settings, Zap, RefreshCw, Loader2,
} from 'lucide-react';
import { Badge } from '@naap/ui';
import { useGatewayDeposit, useProtocolParameters, useOrchestrators } from '@naap/plugin-sdk';
import { useShell } from '@naap/plugin-sdk';
import { useQuery } from '@naap/plugin-sdk';

function formatEth(wei: string): string {
  try {
    const eth = parseFloat(wei) / 1e18;
    if (eth >= 1_000) return `${(eth / 1_000).toFixed(2)}K`;
    return eth.toFixed(4);
  } catch {
    return '0';
  }
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export const GatewaysPage: React.FC = () => {
  const shell = useShell();
  const { data: depositInfo, loading: depositLoading, error: depositError, refetch: refetchDeposit } = useGatewayDeposit();
  const { data: protocol, loading: protocolLoading } = useProtocolParameters();
  const { data: orchestrators } = useOrchestrators();
  const [activeTab, setActiveTab] = useState<'deposit' | 'orchestrators' | 'pricing'>('deposit');

  const loading = depositLoading || protocolLoading;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-accent-blue" />
        <p className="text-text-secondary text-sm">Loading gateway data from Livepeer network...</p>
      </div>
    );
  }

  if (depositError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center px-8">
        <div className="w-16 h-16 rounded-full bg-accent-rose/10 flex items-center justify-center">
          <AlertTriangle size={32} className="text-accent-rose" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-text-primary mb-2">Failed to Load Gateway Data</h3>
          <p className="text-text-secondary text-sm max-w-md">{depositError.message}</p>
        </div>
        <button onClick={() => refetchDeposit()} className="px-4 py-2 bg-accent-blue text-white rounded-lg flex items-center gap-2">
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    );
  }

  const deposit = depositInfo?.deposit || '0';
  const reserve = depositInfo?.reserve?.fundsRemaining || '0';
  const withdrawRound = depositInfo?.withdrawRound || '0';
  const activeOrchCount = (orchestrators || []).filter((o) => o.active).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Gateway Manager</h1>
          <p className="text-text-secondary mt-1">Manage deposits, reserves, and orchestrator connections</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => refetchDeposit()} className="p-3 bg-bg-secondary border border-white/10 rounded-xl hover:bg-bg-tertiary transition-all" title="Refresh">
            <RefreshCw size={18} className="text-text-secondary" />
          </button>
          <button
            onClick={() => shell.notifications?.info?.('Fund deposit flow coming soon')}
            className="flex items-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all"
          >
            <Plus size={18} /> Fund Deposit
          </button>
        </div>
      </div>

      {/* Deposit / Reserve Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-text-secondary">Deposit</p>
            <Zap size={20} className="text-accent-amber" />
          </div>
          <p className="text-3xl font-mono font-bold text-text-primary">{formatEth(deposit)}</p>
          <p className="text-xs text-text-secondary mt-1">LPT deposited for ticket payments</p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-text-secondary">Reserve</p>
            <Database size={20} className="text-accent-blue" />
          </div>
          <p className="text-3xl font-mono font-bold text-text-primary">{formatEth(reserve)}</p>
          <p className="text-xs text-text-secondary mt-1">Reserve for penalty coverage</p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-text-secondary">Connected Orchestrators</p>
            <Cpu size={20} className="text-accent-emerald" />
          </div>
          <p className="text-3xl font-mono font-bold text-accent-emerald">{activeOrchCount}</p>
          <p className="text-xs text-text-secondary mt-1">Active on the network</p>
        </div>
      </div>

      {/* Withdraw Round Info */}
      {withdrawRound !== '0' && (
        <div className="glass-card p-4 border-accent-amber/30">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-accent-amber" />
            <div>
              <p className="text-sm font-bold text-text-primary">Withdrawal Pending</p>
              <p className="text-xs text-text-secondary">
                Withdraw available after round {withdrawRound}
                {protocol?.currentRound ? ` (current: ${protocol.currentRound})` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        {[
          { id: 'deposit' as const, label: 'Deposit & Reserve', icon: <Zap size={16} /> },
          { id: 'orchestrators' as const, label: 'Orchestrators', icon: <Cpu size={16} /> },
          { id: 'pricing' as const, label: 'Pricing', icon: <Settings size={16} /> },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
              activeTab === tab.id ? 'text-accent-blue border-accent-blue' : 'text-text-secondary border-transparent hover:text-text-primary'
            }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'deposit' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6 space-y-4">
            <h3 className="text-lg font-bold text-text-primary">Ticket Broker Parameters</h3>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-text-secondary">Current Round</span>
                <span className="font-mono text-text-primary">{protocol?.currentRound || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-text-secondary">Round Length</span>
                <span className="font-mono text-text-primary">{protocol?.roundLength || 'N/A'} blocks</span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-text-secondary">Withdraw Round</span>
                <span className="font-mono text-text-primary">{withdrawRound === '0' ? 'None' : withdrawRound}</span>
              </div>
            </div>
          </div>

          <div className="glass-card p-6 space-y-4">
            <h3 className="text-lg font-bold text-text-primary">Actions</h3>
            <div className="space-y-3">
              <button onClick={() => shell.notifications?.info?.('Fund deposit flow coming soon')}
                className="w-full px-4 py-3 bg-accent-blue text-white rounded-xl font-medium hover:bg-accent-blue/90 transition-all">
                Fund Deposit & Reserve
              </button>
              <button onClick={() => shell.notifications?.info?.('Unlock flow coming soon')}
                className="w-full px-4 py-3 bg-bg-tertiary border border-white/10 text-text-primary rounded-xl font-medium hover:bg-white/5 transition-all">
                Unlock for Withdrawal
              </button>
              <button onClick={() => shell.notifications?.info?.('Withdraw flow coming soon')}
                className="w-full px-4 py-3 bg-bg-tertiary border border-white/10 text-text-primary rounded-xl font-medium hover:bg-white/5 transition-all">
                Withdraw Funds
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'orchestrators' && (
        <div className="space-y-4">
          <p className="text-text-secondary text-sm">{activeOrchCount} orchestrators active on the network</p>
          {(orchestrators || []).slice(0, 10).map((orch) => (
            <div key={orch.address} className="glass-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-accent-blue/10 flex items-center justify-center">
                  <Cpu size={18} className="text-accent-blue" />
                </div>
                <div>
                  <p className="font-medium font-mono text-sm text-text-primary">{shortenAddress(orch.address)}</p>
                  <p className="text-xs text-text-secondary">{formatEth(orch.delegatedStake || '0')} LPT staked</p>
                </div>
              </div>
              <Badge variant={orch.active ? 'emerald' : 'amber'}>{orch.active ? 'Active' : 'Inactive'}</Badge>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'pricing' && (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-lg font-bold text-text-primary">Gateway Pricing Configuration</h3>
          <p className="text-text-secondary text-sm">
            Configure maximum prices per pixel and per AI capability. These settings determine which
            orchestrators your gateway will select for jobs.
          </p>
          <div className="flex items-center justify-center h-32 border border-dashed border-white/10 rounded-xl">
            <p className="text-text-secondary">Pricing configuration coming in a future update</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default GatewaysPage;

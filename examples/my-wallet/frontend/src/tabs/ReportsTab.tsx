/**
 * Reports Tab - On-chain staking history, gas accounting, exports
 *
 * Transaction History: real staking events from subgraph/RPC
 * Gas Costs: derived from event count
 * Export: orchestrators + positions data
 */

import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Fuel, Download, ExternalLink, ArrowUpRight, ArrowDownRight, Gift, RefreshCw, RotateCcw, TrendingUp, BarChart3 } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { useExport } from '../hooks/useExport';
import { usePrices } from '../hooks/usePrices';
import { useGasAccounting } from '../hooks/useGasAccounting';
import { formatAddress } from '../lib/utils';
import { getApiUrl } from '../App';
import { OrchestratorPerformance } from '../components/OrchestratorPerformance';

interface StakingEvent {
  type: 'bond' | 'unbond' | 'rebond' | 'reward' | 'withdrawFees' | 'withdrawStake';
  timestamp: number;
  round: number;
  amount: string;
  orchestrator: string | null;
  txHash: string | null;
}

type SubView = 'pnl' | 'performance' | 'transactions' | 'gas' | 'export';

export const ReportsTab: React.FC = () => {
  const [subView, setSubView] = useState<SubView>('pnl');

  return (
    <div className="space-y-6">
      <div className="flex gap-1 bg-[var(--bg-tertiary)] p-1 rounded-lg w-fit flex-wrap">
        {([
          { id: 'pnl' as SubView, label: 'P&L Report', icon: <TrendingUp className="w-3.5 h-3.5" /> },
          { id: 'performance' as SubView, label: 'Performance', icon: <BarChart3 className="w-3.5 h-3.5" /> },
          { id: 'transactions' as SubView, label: 'Staking History', icon: <FileText className="w-3.5 h-3.5" /> },
          { id: 'gas' as SubView, label: 'Gas Costs', icon: <Fuel className="w-3.5 h-3.5" /> },
          { id: 'export' as SubView, label: 'Export', icon: <Download className="w-3.5 h-3.5" /> },
        ]).map(s => (
          <button
            key={s.id}
            onClick={() => setSubView(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subView === s.id
                ? 'bg-[var(--bg-primary)] text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      {subView === 'pnl' && <PnlView />}
      {subView === 'performance' && <OrchestratorPerformance />}
      {subView === 'transactions' && <StakingHistoryView />}
      {subView === 'gas' && <GasView />}
      {subView === 'export' && <ExportView />}
    </div>
  );
};

/** P&L Report — profit and loss from on-chain data */
const PnlView: React.FC = () => {
  const { address, accounts, isConnected } = useWallet();
  const prices = usePrices();
  const [pnlData, setPnlData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [period, setPeriod] = useState<string>('1y');
  const [isExporting, setIsExporting] = useState(false);

  const getPeriodDates = useCallback(() => {
    const now = new Date();
    let start: Date;
    switch (period) {
      case '1m': start = new Date(now.getTime() - 30 * 86400000); break;
      case '3m': start = new Date(now.getTime() - 91 * 86400000); break;
      case '6m': start = new Date(now.getTime() - 182 * 86400000); break;
      case '1y': start = new Date(now.getTime() - 365 * 86400000); break;
      case 'all': start = new Date('2021-01-01'); break;
      default: start = new Date(now.getTime() - 365 * 86400000);
    }
    return { start, end: now };
  }, [period]);

  const fetchPnl = useCallback(async () => {
    if (!isConnected || !address) return;
    setIsLoading(true);
    try {
      const { start, end } = getPeriodDates();
      // Fetch P&L for all connected accounts
      const allAddresses = accounts.length > 0 ? accounts : [address];
      const results = await Promise.all(
        allAddresses.map(async (addr) => {
          const params = new URLSearchParams({
            address: addr,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
          });
          const res = await fetch(`${getApiUrl()}/export/pnl?${params}`);
          if (!res.ok) return null;
          const json = await res.json();
          return json.data;
        })
      );

      // Merge results
      const merged = {
        rows: results.flatMap(r => r?.rows || []),
        totals: {
          totalStaked: '0', totalPrincipal: '0', totalRewards: '0',
          totalFees: '0', avgDailyReward: '0', avgAPR: '0',
        },
        prices: results.find(r => r?.prices)?.prices || { lptUsd: 0, ethUsd: 0 },
      };

      // Sum totals
      let totalStaked = 0, totalPrincipal = 0, totalRewards = 0, totalFees = 0, totalDaily = 0;
      for (const r of results) {
        if (!r?.totals) continue;
        totalStaked += parseFloat(r.totals.totalStaked || '0');
        totalPrincipal += parseFloat(r.totals.totalPrincipal || '0');
        totalRewards += parseFloat(r.totals.totalRewards || '0');
        totalFees += parseFloat(r.totals.totalFees || '0');
        totalDaily += parseFloat(r.totals.avgDailyReward || '0');
      }
      merged.totals = {
        totalStaked: totalStaked.toFixed(4),
        totalPrincipal: totalPrincipal.toFixed(4),
        totalRewards: totalRewards.toFixed(4),
        totalFees: totalFees.toFixed(8),
        avgDailyReward: totalDaily.toFixed(4),
        avgAPR: totalPrincipal > 0 ? ((totalRewards / totalPrincipal) * 100).toFixed(2) : '0',
      };

      setPnlData(merged);
    } catch (err) {
      console.error('Failed to fetch P&L:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, accounts, getPeriodDates]);

  useEffect(() => { fetchPnl(); }, [fetchPnl]);

  const exportPnl = useCallback(async (format: 'csv' | 'json') => {
    if (!address) return;
    setIsExporting(true);
    try {
      const { start, end } = getPeriodDates();
      const params = new URLSearchParams({
        address,
        format,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      const res = await fetch(`${getApiUrl()}/export/pnl?${params}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      downloadBlob(blob, `wallet-pnl.${format}`);
    } catch (err) {
      console.error('P&L export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, [address, getPeriodDates]);

  const fmtNum = (n: number | string, dec = 2) => {
    const v = typeof n === 'string' ? parseFloat(n) : n;
    if (isNaN(v) || v === 0) return '0';
    return v.toLocaleString(undefined, { maximumFractionDigits: dec });
  };

  const lptUsd = pnlData?.prices?.lptUsd || prices.lptUsd;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Profit & Loss Report</h2>
          <p className="text-xs text-text-tertiary">Staking returns based on on-chain data</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-[var(--bg-tertiary)] p-0.5 rounded-lg">
            {['1m', '3m', '6m', '1y', 'all'].map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                  period === p
                    ? 'bg-[var(--bg-primary)] text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {p === 'all' ? 'All' : p.toUpperCase()}
              </button>
            ))}
          </div>
          <button onClick={fetchPnl} className="p-1 rounded hover:bg-[var(--bg-tertiary)]">
            <RefreshCw className={`w-3.5 h-3.5 text-text-tertiary ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {isLoading && !pnlData ? (
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="glass-card p-4 h-20 animate-pulse" />)}
        </div>
      ) : pnlData ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-3">
              <p className="text-[10px] text-text-tertiary mb-1">Total Staked</p>
              <p className="text-sm font-mono font-semibold text-accent-emerald">{fmtNum(pnlData.totals.totalStaked)} LPT</p>
              {lptUsd > 0 && <p className="text-[10px] text-text-tertiary font-mono">${fmtNum(parseFloat(pnlData.totals.totalStaked) * lptUsd)}</p>}
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-text-tertiary mb-1">Principal (Cost Basis)</p>
              <p className="text-sm font-mono font-semibold text-text-primary">{fmtNum(pnlData.totals.totalPrincipal)} LPT</p>
              {lptUsd > 0 && <p className="text-[10px] text-text-tertiary font-mono">${fmtNum(parseFloat(pnlData.totals.totalPrincipal) * lptUsd)}</p>}
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-text-tertiary mb-1">Rewards Earned</p>
              <p className="text-sm font-mono font-semibold text-accent-emerald">{fmtNum(pnlData.totals.totalRewards)} LPT</p>
              {lptUsd > 0 && <p className="text-[10px] text-text-tertiary font-mono">${fmtNum(parseFloat(pnlData.totals.totalRewards) * lptUsd)}</p>}
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-text-tertiary mb-1">Daily Reward Rate</p>
              <p className="text-sm font-mono font-semibold text-accent-emerald">{fmtNum(pnlData.totals.avgDailyReward)} LPT</p>
              {lptUsd > 0 && <p className="text-[10px] text-text-tertiary font-mono">${fmtNum(parseFloat(pnlData.totals.avgDailyReward) * lptUsd)}/day</p>}
            </div>
          </div>

          {/* Net Return */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-text-primary">Net Return</p>
              {parseFloat(pnlData.totals.avgAPR) > 0 && (
                <span className="text-xs font-mono text-accent-emerald bg-accent-emerald/10 px-2 py-0.5 rounded">
                  {fmtNum(pnlData.totals.avgAPR)}% return
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-text-tertiary">Monthly Est.</p>
                <p className="text-sm font-mono font-semibold text-accent-emerald">
                  {fmtNum(parseFloat(pnlData.totals.avgDailyReward) * 30)} LPT
                </p>
                {lptUsd > 0 && (
                  <p className="text-[10px] text-text-tertiary font-mono">
                    ${fmtNum(parseFloat(pnlData.totals.avgDailyReward) * 30 * lptUsd)}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] text-text-tertiary">Quarterly Est.</p>
                <p className="text-sm font-mono font-semibold text-accent-emerald">
                  {fmtNum(parseFloat(pnlData.totals.avgDailyReward) * 91)} LPT
                </p>
                {lptUsd > 0 && (
                  <p className="text-[10px] text-text-tertiary font-mono">
                    ${fmtNum(parseFloat(pnlData.totals.avgDailyReward) * 91 * lptUsd)}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] text-text-tertiary">Yearly Est.</p>
                <p className="text-sm font-mono font-semibold text-accent-emerald">
                  {fmtNum(parseFloat(pnlData.totals.avgDailyReward) * 365)} LPT
                </p>
                {lptUsd > 0 && (
                  <p className="text-[10px] text-text-tertiary font-mono">
                    ${fmtNum(parseFloat(pnlData.totals.avgDailyReward) * 365 * lptUsd)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Per-wallet breakdown */}
          {pnlData.rows.length > 0 && (
            <div className="glass-card overflow-hidden divide-y divide-[var(--border-color)]">
              <div className="px-3 py-2 bg-[var(--bg-tertiary)]/50">
                <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">Per Wallet</p>
              </div>
              {pnlData.rows.map((row: any, i: number) => (
                <div key={row.address || i} className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-mono text-text-primary">{formatAddress(row.address, 8)}</p>
                    <p className="text-xs font-mono text-accent-emerald">{fmtNum(row.dailyRewardRate)} LPT/day</p>
                  </div>
                  <div className="flex gap-4 text-[10px] text-text-tertiary">
                    <span>Staked: {fmtNum(row.totalStaked)} LPT</span>
                    <span>Principal: {fmtNum(row.principal)} LPT</span>
                    <span>Rewards: {fmtNum(row.accumulatedRewards)} LPT</span>
                    <span>APR: {row.annualizedAPR}%</span>
                  </div>
                  {row.orchestrator && row.orchestrator !== 'None' && (
                    <p className="text-[10px] text-text-tertiary">
                      Delegated to: {formatAddress(row.orchestrator, 8)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Export */}
          <div className="flex gap-2">
            <button
              onClick={() => exportPnl('csv')}
              disabled={isExporting}
              className="flex-1 py-2 bg-accent-emerald text-white text-xs font-medium rounded-lg hover:bg-accent-emerald/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              {isExporting ? 'Exporting...' : 'Export P&L CSV'}
            </button>
            <button
              onClick={() => exportPnl('json')}
              disabled={isExporting}
              className="px-4 py-2 bg-[var(--bg-tertiary)] text-text-primary text-xs font-medium rounded-lg hover:bg-[var(--bg-secondary)] disabled:opacity-50 transition-colors"
            >
              JSON
            </button>
          </div>
        </>
      ) : (
        <div className="glass-card p-8 text-center">
          <TrendingUp className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">Connect wallet to view P&L report</p>
        </div>
      )}
    </div>
  );
};

/** Staking History — on-chain events */
const StakingHistoryView: React.FC = () => {
  const { address, chainId, isConnected } = useWallet();
  const prices = usePrices();
  const [events, setEvents] = useState<StakingEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const fetchHistory = useCallback(async () => {
    if (!isConnected || !address) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/staking/history?address=${address}`);
      if (res.ok) {
        const json = await res.json();
        setEvents(json.data?.events || []);
      }
    } catch (err) {
      console.error('Failed to fetch staking history:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const filtered = typeFilter === 'all'
    ? events
    : events.filter(e => e.type === typeFilter);

  // Summary stats
  const totalRewards = events
    .filter(e => e.type === 'reward')
    .reduce((sum, e) => sum + parseFloat(e.amount) / 1e18, 0);
  const totalFees = events
    .filter(e => e.type === 'withdrawFees')
    .reduce((sum, e) => sum + parseFloat(e.amount) / 1e18, 0);
  const totalStaked = events
    .filter(e => e.type === 'bond')
    .reduce((sum, e) => sum + parseFloat(e.amount) / 1e18, 0);
  const totalUnstaked = events
    .filter(e => e.type === 'unbond')
    .reduce((sum, e) => sum + parseFloat(e.amount) / 1e18, 0);

  const eventTypeConfig: Record<string, { label: string; color: string; icon: React.ReactNode; unit: string }> = {
    bond: { label: 'Stake', color: 'text-accent-emerald bg-accent-emerald/10', icon: <ArrowUpRight className="w-3 h-3" />, unit: 'LPT' },
    unbond: { label: 'Unstake', color: 'text-accent-amber bg-accent-amber/10', icon: <ArrowDownRight className="w-3 h-3" />, unit: 'LPT' },
    rebond: { label: 'Rebond', color: 'text-accent-emerald bg-accent-emerald/10', icon: <RotateCcw className="w-3 h-3" />, unit: 'LPT' },
    reward: { label: 'Reward', color: 'text-accent-emerald bg-accent-emerald/10', icon: <Gift className="w-3 h-3" />, unit: 'LPT' },
    withdrawFees: { label: 'Fee Withdrawal', color: 'text-accent-blue bg-accent-blue/10', icon: <ArrowDownRight className="w-3 h-3" />, unit: 'ETH' },
    withdrawStake: { label: 'Withdraw', color: 'text-accent-amber bg-accent-amber/10', icon: <ArrowDownRight className="w-3 h-3" />, unit: 'LPT' },
  };

  const explorerBase = chainId === 42161 ? 'https://arbiscan.io/tx/' : 'https://etherscan.io/tx/';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Staking History</h2>
          <p className="text-xs text-text-tertiary">{events.length} on-chain events</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="px-2 py-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-[11px] text-text-primary"
          >
            <option value="all">All Types</option>
            <option value="bond">Stake</option>
            <option value="unbond">Unstake</option>
            <option value="reward">Rewards</option>
            <option value="withdrawFees">Fee Withdrawals</option>
            <option value="rebond">Rebond</option>
            <option value="withdrawStake">Withdraw</option>
          </select>
          <button onClick={fetchHistory} className="p-1 rounded hover:bg-[var(--bg-tertiary)]">
            <RefreshCw className={`w-3.5 h-3.5 text-text-tertiary ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {events.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass-card p-3">
            <p className="text-[10px] text-text-tertiary mb-1">Total Staked</p>
            <p className="text-sm font-mono font-semibold text-accent-emerald">{totalStaked.toLocaleString(undefined, { maximumFractionDigits: 2 })} LPT</p>
            {prices.lptUsd > 0 && <p className="text-[10px] text-text-tertiary font-mono">${(totalStaked * prices.lptUsd).toFixed(2)}</p>}
          </div>
          <div className="glass-card p-3">
            <p className="text-[10px] text-text-tertiary mb-1">Total Rewards</p>
            <p className="text-sm font-mono font-semibold text-accent-emerald">{totalRewards.toLocaleString(undefined, { maximumFractionDigits: 2 })} LPT</p>
            {prices.lptUsd > 0 && <p className="text-[10px] text-text-tertiary font-mono">${(totalRewards * prices.lptUsd).toFixed(2)}</p>}
          </div>
          <div className="glass-card p-3">
            <p className="text-[10px] text-text-tertiary mb-1">Total Unstaked</p>
            <p className="text-sm font-mono font-semibold text-accent-amber">{totalUnstaked.toLocaleString(undefined, { maximumFractionDigits: 2 })} LPT</p>
          </div>
          <div className="glass-card p-3">
            <p className="text-[10px] text-text-tertiary mb-1">Fee Income</p>
            <p className="text-sm font-mono font-semibold text-accent-blue">{totalFees.toFixed(6)} ETH</p>
            {prices.ethUsd > 0 && <p className="text-[10px] text-text-tertiary font-mono">${(totalFees * prices.ethUsd).toFixed(2)}</p>}
          </div>
        </div>
      )}

      {/* Event List */}
      {isLoading && events.length === 0 ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <div key={i} className="glass-card p-4 h-16 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <FileText className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">
            {events.length === 0 ? 'No staking activity found for this wallet' : 'No events match the selected filter'}
          </p>
          {events.length === 0 && (
            <p className="text-xs text-text-tertiary mt-1">Stake LPT to an orchestrator to start earning</p>
          )}
        </div>
      ) : (
        <div className="glass-card overflow-hidden divide-y divide-[var(--border-color)]">
          {filtered.map((event, i) => {
            const config = eventTypeConfig[event.type] || { label: event.type, color: 'text-text-secondary bg-[var(--bg-tertiary)]', icon: null, unit: 'LPT' };
            const amountNum = parseFloat(event.amount) / 1e18;
            const isLpt = config.unit === 'LPT';
            const usdVal = isLpt ? amountNum * prices.lptUsd : amountNum * prices.ethUsd;

            return (
              <div key={`${event.type}-${event.timestamp}-${i}`} className="p-3 flex items-center gap-3 hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                {/* Type badge */}
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${config.color}`}>
                  {config.icon}
                  {config.label}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {event.orchestrator && (
                      <span className="text-[11px] text-text-secondary">
                        {event.type === 'bond' ? 'to' : event.type === 'unbond' ? 'from' : ''} {formatAddress(event.orchestrator, 6)}
                      </span>
                    )}
                    {event.txHash && (
                      <a
                        href={`${explorerBase}${event.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-tertiary hover:text-accent-emerald"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-[10px] text-text-tertiary">
                    {event.timestamp > 0 ? new Date(event.timestamp * 1000).toLocaleString() : `Round ${event.round}`}
                    {event.round > 0 && event.timestamp > 0 ? ` · R${event.round}` : ''}
                  </p>
                </div>

                {/* Amount */}
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-mono text-text-primary">
                    {isLpt ? amountNum.toLocaleString(undefined, { maximumFractionDigits: 2 }) : amountNum.toFixed(6)}
                    <span className="text-[10px] text-text-tertiary ml-1">{config.unit}</span>
                  </p>
                  {usdVal > 0.01 && (
                    <p className="text-[10px] text-text-tertiary font-mono">${usdVal.toFixed(2)}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Gas Accounting — from transaction logs via useGasAccounting hook */
const GasView: React.FC = () => {
  const { isConnected } = useWallet();
  const { summary, isLoading, refresh } = useGasAccounting();

  const formatEthGas = (wei: string) => {
    const n = parseFloat(wei) / 1e18;
    if (n === 0) return '0';
    if (n < 0.0001) return '<0.0001';
    return n.toFixed(6);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-1">Gas Cost Summary</h2>
          <p className="text-xs text-text-tertiary">Total gas spent on staking operations</p>
        </div>
        <button onClick={refresh} className="p-1 rounded hover:bg-[var(--bg-tertiary)]">
          <RefreshCw className={`w-3.5 h-3.5 text-text-tertiary ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading && !summary ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="glass-card p-4 h-20 animate-pulse" />)}
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Total Gas Cost</p>
              <p className="text-lg font-bold font-mono text-text-primary">
                {formatEthGas(summary.totalGasCostWei)} ETH
              </p>
              {summary.totalGasCostEth > 0 && (
                <p className="text-[10px] text-text-tertiary font-mono">
                  {summary.totalGasCostEth.toFixed(6)} ETH
                </p>
              )}
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Transactions</p>
              <p className="text-lg font-bold font-mono text-text-primary">
                {summary.transactionCount}
              </p>
              {summary.avgGasPerTx > 0 && (
                <p className="text-[10px] text-text-tertiary font-mono">
                  Avg: {summary.avgGasPerTx.toLocaleString()} gas/tx
                </p>
              )}
            </div>
          </div>

          {/* By Type breakdown */}
          {Object.keys(summary.byType).length > 0 && (
            <div className="glass-card overflow-hidden">
              <div className="px-3 py-2 bg-[var(--bg-tertiary)]/50">
                <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">Cost by Transaction Type</p>
              </div>
              <div className="divide-y divide-[var(--border-color)]">
                {Object.entries(summary.byType).map(([type, data]) => (
                  <div key={type} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs capitalize text-text-primary">{type}</span>
                      <span className="text-[10px] text-text-tertiary">({data.count} tx)</span>
                    </div>
                    <span className="text-xs font-mono text-text-primary">
                      {formatEthGas(data.totalGasWei)} ETH
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.transactionCount === 0 && (
            <div className="glass-card p-4">
              <p className="text-xs text-text-tertiary">
                No transactions logged yet. Gas costs will accumulate as you stake, unstake, and claim rewards through the wallet.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="glass-card p-8 text-center">
          <Fuel className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">
            {isConnected ? 'No gas data available' : 'Connect wallet to view gas costs'}
          </p>
        </div>
      )}
    </div>
  );
};

/** Export View */
const ExportView: React.FC = () => {
  const { address, isConnected } = useWallet();
  const dataExport = useExport();
  const [isExportingHistory, setIsExportingHistory] = useState(false);

  const exportStakingHistory = useCallback(async (format: 'json' | 'csv') => {
    if (!address) return;
    setIsExportingHistory(true);
    try {
      const res = await fetch(`${getApiUrl()}/staking/history?address=${address}`);
      const json = await res.json();
      const events = json.data?.events || [];

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'staking-history.json');
      } else {
        const headers = 'Type,Timestamp,Round,Amount,Unit,Orchestrator,TxHash\n';
        const rows = events.map((e: StakingEvent) => {
          const isLpt = e.type !== 'withdrawFees';
          const amount = parseFloat(e.amount) / 1e18;
          return `${e.type},${new Date(e.timestamp * 1000).toISOString()},${e.round},${amount},${isLpt ? 'LPT' : 'ETH'},${e.orchestrator || ''},${e.txHash || ''}`;
        }).join('\n');
        const blob = new Blob([headers + rows], { type: 'text/csv' });
        downloadBlob(blob, 'staking-history.csv');
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExportingHistory(false);
    }
  }, [address]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">Export Data</h2>
        <p className="text-xs text-text-tertiary">Download your staking data for tax reporting or analysis</p>
      </div>

      {/* Staking History Export */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-accent-emerald" />
          <h3 className="text-sm font-semibold text-text-primary">Staking History</h3>
        </div>
        <p className="text-xs text-text-tertiary">
          Export all staking events: bonds, unbonds, rewards, and fee withdrawals
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => exportStakingHistory('csv')}
            disabled={isExportingHistory || !isConnected}
            className="flex-1 py-2 bg-accent-emerald text-white text-sm font-medium rounded-lg hover:bg-accent-emerald/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            {isExportingHistory ? 'Exporting...' : 'Export CSV'}
          </button>
          <button
            onClick={() => exportStakingHistory('json')}
            disabled={isExportingHistory || !isConnected}
            className="px-4 py-2 bg-[var(--bg-tertiary)] text-text-primary text-sm font-medium rounded-lg hover:bg-[var(--bg-secondary)] disabled:opacity-50 transition-colors"
          >
            JSON
          </button>
        </div>
      </div>

      {/* Data Exports */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-accent-blue" />
          <h3 className="text-sm font-semibold text-text-primary">Data Exports</h3>
        </div>

        <div className="space-y-2">
          <ExportRow
            label="Orchestrator Leaderboard"
            description="All orchestrators with stats"
            onCSV={() => dataExport.exportCSV('leaderboard')}
            onJSON={() => dataExport.exportJSON('leaderboard')}
            isExporting={dataExport.isExporting}
          />
          <ExportRow
            label="Staking Positions"
            description="Your current delegations"
            onCSV={() => dataExport.exportCSV('positions')}
            onJSON={() => dataExport.exportJSON('positions')}
            isExporting={dataExport.isExporting}
          />
        </div>
      </div>
    </div>
  );
};

const ExportRow: React.FC<{
  label: string;
  description: string;
  onCSV: () => void;
  onJSON: () => void;
  isExporting: boolean;
}> = ({ label, description, onCSV, onJSON, isExporting }) => (
  <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)] last:border-0">
    <div>
      <p className="text-xs font-medium text-text-primary">{label}</p>
      <p className="text-[10px] text-text-tertiary">{description}</p>
    </div>
    <div className="flex gap-1">
      <button
        onClick={onCSV}
        disabled={isExporting}
        className="px-2.5 py-1 text-[10px] font-medium bg-[var(--bg-tertiary)] text-text-primary rounded hover:bg-accent-emerald hover:text-white disabled:opacity-50 transition-colors"
      >
        CSV
      </button>
      <button
        onClick={onJSON}
        disabled={isExporting}
        className="px-2.5 py-1 text-[10px] font-medium bg-[var(--bg-tertiary)] text-text-primary rounded hover:bg-accent-emerald hover:text-white disabled:opacity-50 transition-colors"
      >
        JSON
      </button>
    </div>
  </div>
);

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

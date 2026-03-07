/**
 * Reports Tab - History, gas accounting, P&L, exports
 *
 * Transaction History with filters
 * Gas Accounting summary
 * P&L Export
 * Yield over time
 */

import React, { useState } from 'react';
import { FileText, Fuel, Download, ExternalLink } from 'lucide-react';
import { useTransactions } from '../hooks/useTransactions';
import { useGasAccounting } from '../hooks/useGasAccounting';
import { usePnlExport } from '../hooks/usePnlExport';
import { useExport } from '../hooks/useExport';
import { useWallet } from '../context/WalletContext';
import { formatTxHash, formatBalance, getExplorerTxUrl } from '../lib/utils';

type SubView = 'transactions' | 'gas' | 'export';

export const ReportsTab: React.FC = () => {
  const [subView, setSubView] = useState<SubView>('transactions');

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex gap-1 bg-[var(--bg-tertiary)] p-1 rounded-lg w-fit">
        {([
          { id: 'transactions' as SubView, label: 'Transactions', icon: <FileText className="w-3.5 h-3.5" /> },
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

      {subView === 'transactions' && <TransactionsView />}
      {subView === 'gas' && <GasView />}
      {subView === 'export' && <ExportView />}
    </div>
  );
};

/** Transaction History */
const TransactionsView: React.FC = () => {
  const { chainId } = useWallet();
  const { transactions, isLoading, total, hasMore, loadMore } = useTransactions(20);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = transactions.filter(tx => {
    if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
    if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
    return true;
  });

  const statusColor = (s: string) =>
    s === 'confirmed' ? 'text-accent-emerald bg-accent-emerald/10'
      : s === 'pending' ? 'text-accent-amber bg-accent-amber/10'
        : 'text-accent-rose bg-accent-rose/10';

  const typeLabel = (t: string) =>
    t === 'stake' ? 'Stake' : t === 'unstake' ? 'Unstake' : t === 'claim' ? 'Claim' : t === 'transfer' ? 'Transfer' : t;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Transaction History</h2>
          <p className="text-xs text-text-tertiary">{total} total transactions</p>
        </div>
        <div className="flex gap-2">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="px-2 py-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-[11px] text-text-primary"
          >
            <option value="all">All Types</option>
            <option value="stake">Stake</option>
            <option value="unstake">Unstake</option>
            <option value="claim">Claim</option>
            <option value="transfer">Transfer</option>
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-2 py-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-[11px] text-text-primary"
          >
            <option value="all">All Status</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {isLoading && transactions.length === 0 ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <div key={i} className="glass-card p-4 h-16 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <FileText className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">No transactions found</p>
        </div>
      ) : (
        <>
          <div className="glass-card overflow-hidden divide-y divide-[var(--border-color)]">
            {filtered.map(tx => (
              <div key={tx.id} className="p-3 flex items-center gap-3 hover:bg-[var(--bg-tertiary)] transition-colors">
                {/* Type badge */}
                <div className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize ${
                  tx.type === 'stake' ? 'bg-accent-purple/10 text-accent-purple'
                    : tx.type === 'claim' ? 'bg-accent-emerald/10 text-accent-emerald'
                      : tx.type === 'unstake' ? 'bg-accent-amber/10 text-accent-amber'
                        : 'bg-[var(--bg-tertiary)] text-text-secondary'
                }`}>
                  {typeLabel(tx.type)}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-primary">{formatTxHash(tx.txHash, 6)}</span>
                    <a
                      href={getExplorerTxUrl(chainId || 42161, tx.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-tertiary hover:text-accent-purple"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-[10px] text-text-tertiary">
                    {new Date(tx.timestamp).toLocaleString()}
                  </p>
                </div>

                {/* Value */}
                {tx.value && (
                  <div className="text-right">
                    <p className="text-xs font-mono text-text-primary">{formatBalance(tx.value)}</p>
                    <p className="text-[10px] text-text-tertiary">LPT</p>
                  </div>
                )}

                {/* Status */}
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(tx.status)}`}>
                  {tx.status}
                </span>
              </div>
            ))}
          </div>

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={isLoading}
              className="w-full py-2 text-xs text-accent-purple hover:underline disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
};

/** Gas Accounting */
const GasView: React.FC = () => {
  const gas = useGasAccounting();
  const summary = gas.summary;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">Gas Cost Summary</h2>
        <p className="text-xs text-text-tertiary">Track your total transaction costs</p>
      </div>

      {gas.isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="glass-card p-4 h-24 animate-pulse" />)}
        </div>
      ) : summary ? (
        <>
          {/* Hero: Total Gas Cost */}
          <div className="glass-card p-6 text-center">
            <p className="text-3xl font-bold font-mono text-accent-rose">
              {summary.totalGasCostEth.toFixed(6)}
            </p>
            <p className="text-xs text-text-tertiary mt-1">Total Gas Cost (ETH)</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Transactions</p>
              <p className="text-lg font-bold font-mono text-text-primary">{summary.transactionCount}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Avg Gas / Tx</p>
              <p className="text-lg font-bold font-mono text-text-primary">
                {summary.avgGasPerTx.toLocaleString()}
              </p>
            </div>
          </div>

          {/* By Type */}
          {Object.keys(summary.byType).length > 0 && (
            <div className="glass-card overflow-hidden">
              <div className="p-3 border-b border-[var(--border-color)]">
                <p className="text-xs font-semibold text-text-primary">Gas by Transaction Type</p>
              </div>
              <div className="divide-y divide-[var(--border-color)]">
                {Object.entries(summary.byType).map(([type, info]) => (
                  <div key={type} className="px-3 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-text-primary capitalize">{type}</span>
                      <span className="text-[10px] text-text-tertiary">{info.count} txs</span>
                    </div>
                    <span className="text-xs font-mono text-text-primary">
                      {formatBalance(info.totalGasWei)} Gwei
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="glass-card p-8 text-center">
          <Fuel className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">Connect wallet to view gas costs</p>
        </div>
      )}
    </div>
  );
};

/** Export View */
const ExportView: React.FC = () => {
  const pnl = usePnlExport();
  const dataExport = useExport();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">Export Data</h2>
        <p className="text-xs text-text-tertiary">Download your staking data for tax reporting or analysis</p>
      </div>

      {/* P&L Export */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-accent-purple" />
          <h3 className="text-sm font-semibold text-text-primary">Profit & Loss Report</h3>
        </div>
        <p className="text-xs text-text-tertiary">
          Export staking rewards, fees earned, and gas costs for a given period
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-text-secondary mb-1 block">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full p-2 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="text-[11px] text-text-secondary mb-1 block">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full p-2 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm text-text-primary"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => pnl.exportPnl('csv', startDate || undefined, endDate || undefined)}
            disabled={pnl.isExporting}
            className="flex-1 py-2 bg-accent-purple text-white text-sm font-medium rounded-lg hover:bg-accent-purple/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            {pnl.isExporting ? 'Exporting...' : 'Export CSV'}
          </button>
          <button
            onClick={() => pnl.exportPnl('json', startDate || undefined, endDate || undefined)}
            disabled={pnl.isExporting}
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
        className="px-2.5 py-1 text-[10px] font-medium bg-[var(--bg-tertiary)] text-text-primary rounded hover:bg-accent-purple hover:text-white disabled:opacity-50 transition-colors"
      >
        CSV
      </button>
      <button
        onClick={onJSON}
        disabled={isExporting}
        className="px-2.5 py-1 text-[10px] font-medium bg-[var(--bg-tertiary)] text-text-primary rounded hover:bg-accent-purple hover:text-white disabled:opacity-50 transition-colors"
      >
        JSON
      </button>
    </div>
  </div>
);

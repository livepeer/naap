/**
 * Gas summary card for transaction history (S7)
 */

import React from 'react';
import { Fuel } from 'lucide-react';

interface GasSummaryCardProps {
  totalGasCostEth: number;
  transactionCount: number;
  avgGasPerTx: number;
  byType: Record<string, { count: number; totalGasWei: string }>;
  isLoading?: boolean;
}

export const GasSummaryCard: React.FC<GasSummaryCardProps> = ({
  totalGasCostEth,
  transactionCount,
  avgGasPerTx,
  byType,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="glass-card p-6 animate-pulse">
        <div className="h-4 bg-bg-tertiary rounded w-32 mb-3" />
        <div className="h-8 bg-bg-tertiary rounded w-48" />
      </div>
    );
  }

  return (
    <div className="glass-card p-6" role="region" aria-label="Gas cost summary">
      <div className="flex items-center gap-2 mb-4">
        <Fuel className="w-5 h-5 text-accent-amber" />
        <h3 className="text-sm font-semibold text-text-secondary">Gas Costs</h3>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-text-muted">Total Gas</p>
          <p className="text-lg font-bold font-mono text-accent-amber">
            {totalGasCostEth.toFixed(6)} <span className="text-xs font-normal">ETH</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Transactions</p>
          <p className="text-lg font-bold font-mono text-text-primary">{transactionCount}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Avg Gas/Tx</p>
          <p className="text-lg font-bold font-mono text-text-primary">
            {avgGasPerTx.toLocaleString()}
          </p>
        </div>
      </div>

      {Object.keys(byType).length > 0 && (
        <div className="border-t border-white/5 pt-3">
          <p className="text-xs text-text-muted mb-2">By Type</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byType).map(([type, data]) => (
              <span key={type} className="text-xs bg-bg-tertiary px-2 py-1 rounded font-mono">
                {type}: {data.count}x
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

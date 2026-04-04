/**
 * Rebalancing simulator panel (S8)
 */

import React, { useState } from 'react';
import { ArrowRight, Calculator } from 'lucide-react';
import { parseAmount } from '../lib/utils';

interface SimulationResult {
  fromOrchestrator: { address: string; name: string | null; currentRewardCut: number };
  toOrchestrator: { address: string; name: string | null; currentRewardCut: number };
  amountLpt: number;
  projectedYieldDelta: number;
  unbondingOpportunityCost: number;
  netBenefit: number;
  recommendation: 'favorable' | 'neutral' | 'unfavorable';
}

interface SimulatorPanelProps {
  result: SimulationResult | null;
  isSimulating: boolean;
  error: string | null;
  onSimulate: (from: string, to: string, amountWei: string, unbondingDays?: number) => void;
  onReset: () => void;
}

export const SimulatorPanel: React.FC<SimulatorPanelProps> = ({
  result,
  isSimulating,
  error,
  onSimulate,
  onReset,
}) => {
  const [fromAddr, setFromAddr] = useState('');
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [unbondingDays, setUnbondingDays] = useState('7');

  const handleSimulate = () => {
    if (!fromAddr || !toAddr || !amount) return;
    try {
      const amountWei = parseAmount(amount).toString();
      onSimulate(fromAddr, toAddr, amountWei, parseInt(unbondingDays, 10));
    } catch {
      // Invalid amount
    }
  };

  const getRecommendationStyle = (rec: string) => {
    switch (rec) {
      case 'favorable': return 'text-accent-emerald bg-accent-emerald/10';
      case 'neutral': return 'text-accent-amber bg-accent-amber/10';
      case 'unfavorable': return 'text-accent-rose bg-accent-rose/10';
      default: return 'text-text-muted bg-bg-tertiary';
    }
  };

  return (
    <div className="glass-card p-6" role="region" aria-label="Rebalancing simulator">
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="w-5 h-5 text-accent-blue" />
        <h3 className="text-sm font-semibold text-text-secondary">What-If Simulator</h3>
      </div>

      <div className="space-y-3 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            value={fromAddr}
            onChange={e => setFromAddr(e.target.value)}
            placeholder="From O (0x...)"
            className="p-2 bg-bg-tertiary border border-white/10 rounded text-sm font-mono text-text-primary"
          />
          <input
            type="text"
            value={toAddr}
            onChange={e => setToAddr(e.target.value)}
            placeholder="To O (0x...)"
            className="p-2 bg-bg-tertiary border border-white/10 rounded text-sm font-mono text-text-primary"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Amount (LPT)"
            className="p-2 bg-bg-tertiary border border-white/10 rounded text-sm font-mono text-text-primary"
          />
          <input
            type="number"
            value={unbondingDays}
            onChange={e => setUnbondingDays(e.target.value)}
            placeholder="Unbonding days"
            className="p-2 bg-bg-tertiary border border-white/10 rounded text-sm font-mono text-text-primary"
          />
        </div>
        <button
          onClick={handleSimulate}
          disabled={isSimulating || !fromAddr || !toAddr || !amount}
          className="w-full py-2 bg-accent-blue text-white rounded font-medium text-sm disabled:opacity-50"
        >
          {isSimulating ? 'Simulating...' : 'Simulate Rebalance'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-accent-rose/10 border border-accent-rose/30 rounded text-sm text-accent-rose">
          {error}
        </div>
      )}

      {result && (
        <div className="border-t border-white/5 pt-4 space-y-3">
          <div className="flex items-center justify-center gap-3 text-sm">
            <span className="font-mono text-text-primary">{result.fromOrchestrator.name || 'Source O'}</span>
            <ArrowRight className="w-4 h-4 text-text-muted" />
            <span className="font-mono text-text-primary">{result.toOrchestrator.name || 'Target O'}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-2 bg-bg-tertiary rounded">
              <p className="text-xs text-text-muted">Yield Delta</p>
              <p className={`font-mono font-bold ${result.projectedYieldDelta >= 0 ? 'text-accent-emerald' : 'text-accent-rose'}`}>
                {result.projectedYieldDelta >= 0 ? '+' : ''}{result.projectedYieldDelta.toFixed(2)}%
              </p>
            </div>
            <div className="p-2 bg-bg-tertiary rounded">
              <p className="text-xs text-text-muted">Opportunity Cost</p>
              <p className="font-mono font-bold text-accent-amber">
                {result.unbondingOpportunityCost.toFixed(4)} LPT
              </p>
            </div>
            <div className="p-2 bg-bg-tertiary rounded">
              <p className="text-xs text-text-muted">Net Benefit (1yr)</p>
              <p className={`font-mono font-bold ${result.netBenefit >= 0 ? 'text-accent-emerald' : 'text-accent-rose'}`}>
                {result.netBenefit >= 0 ? '+' : ''}{result.netBenefit.toFixed(4)} LPT
              </p>
            </div>
            <div className="p-2 bg-bg-tertiary rounded">
              <p className="text-xs text-text-muted">Verdict</p>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${getRecommendationStyle(result.recommendation)}`}>
                {result.recommendation}
              </span>
            </div>
          </div>

          <button onClick={onReset} className="text-xs text-text-muted hover:text-text-secondary">
            Reset
          </button>
        </div>
      )}
    </div>
  );
};

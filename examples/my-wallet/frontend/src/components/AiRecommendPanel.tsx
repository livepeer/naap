/**
 * AI recommendation panel (S19)
 */

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { formatAddress, formatBalance } from '../lib/utils';

interface Recommendation {
  address: string;
  name: string | null;
  score: number;
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  isActive: boolean;
  reasons: string[];
}

interface AiRecommendPanelProps {
  recommendations: Recommendation[];
  isLoading: boolean;
  onFetch: (risk: string, yield_: string, diversify?: boolean) => void | Promise<void>;
  onDelegate?: (address: string) => void;
  onWatch?: (address: string) => void;
}

export const AiRecommendPanel: React.FC<AiRecommendPanelProps> = ({
  recommendations,
  isLoading,
  onFetch,
  onDelegate,
  onWatch,
}) => {
  const [risk, setRisk] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');
  const [yield_, setYield_] = useState<'low' | 'medium' | 'high'>('medium');
  const [diversify] = useState(true);

  return (
    <div className="glass-card p-6" role="region" aria-label="AI recommendations">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-accent-purple" />
        <h3 className="text-sm font-semibold text-text-secondary">AI Recommendations</h3>
      </div>

      {/* Profile Selector */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="text-xs text-text-muted mb-1">Risk</p>
          <div className="flex gap-1">
            {(['conservative', 'moderate', 'aggressive'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRisk(r)}
                className={`px-2 py-1 text-xs rounded capitalize ${
                  risk === r ? 'bg-accent-purple text-white' : 'bg-bg-tertiary text-text-secondary'
                }`}
              >
                {r.slice(0, 4)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Yield</p>
          <div className="flex gap-1">
            {(['low', 'medium', 'high'] as const).map(y => (
              <button
                key={y}
                onClick={() => setYield_(y)}
                className={`px-2 py-1 text-xs rounded capitalize ${
                  yield_ === y ? 'bg-accent-purple text-white' : 'bg-bg-tertiary text-text-secondary'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end">
          <button
            onClick={() => onFetch(risk, yield_, diversify)}
            disabled={isLoading}
            className="w-full py-1.5 bg-accent-purple text-white rounded text-xs font-medium disabled:opacity-50"
          >
            {isLoading ? '...' : 'Get Picks'}
          </button>
        </div>
      </div>

      {/* Results */}
      {recommendations.length > 0 && (
        <div className="space-y-2">
          {recommendations.map((rec, i) => (
            <div key={rec.address} className="p-3 bg-bg-tertiary rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-accent-purple">#{i + 1}</span>
                  <span className="text-sm font-medium text-text-primary">
                    {rec.name || formatAddress(rec.address)}
                  </span>
                </div>
                <span className="text-xs font-mono text-accent-emerald">{rec.score}/100</span>
              </div>
              <div className="flex gap-3 text-xs text-text-muted mb-1">
                <span>Cut: {rec.rewardCut}%</span>
                <span>Fee: {rec.feeShare}%</span>
                <span>Stake: {formatBalance(rec.totalStake)} LPT</span>
              </div>
              {rec.reasons.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {rec.reasons.map((r, j) => (
                    <span key={j} className="text-xs bg-accent-purple/10 text-accent-purple px-1.5 py-0.5 rounded">
                      {r}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-2">
                {onWatch && (
                  <button
                    onClick={() => onWatch(rec.address)}
                    className="text-xs text-accent-blue hover:text-accent-blue/80"
                  >
                    + Watch
                  </button>
                )}
                {onDelegate && (
                  <button
                    onClick={() => onDelegate(rec.address)}
                    className="text-xs text-accent-emerald hover:text-accent-emerald/80"
                  >
                    Delegate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

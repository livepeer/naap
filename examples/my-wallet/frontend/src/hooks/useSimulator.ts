/**
 * Rebalancing simulator hook (S8)
 */

import { useState, useCallback } from 'react';
import { getApiUrl } from '../App';

interface SimulationResult {
  fromOrchestrator: { address: string; name: string | null; currentRewardCut: number; currentFeeShare: number };
  toOrchestrator: { address: string; name: string | null; currentRewardCut: number; currentFeeShare: number };
  amountLpt: number;
  projectedYieldDelta: number;
  unbondingOpportunityCost: number;
  rewardCutDiff: number;
  feeShareDiff: number;
  netBenefit: number;
  recommendation: 'favorable' | 'neutral' | 'unfavorable';
}

export function useSimulator() {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (
    fromOrchestrator: string,
    toOrchestrator: string,
    amountWei: string,
    unbondingPeriodDays?: number,
  ) => {
    setIsSimulating(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/simulator/rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromOrchestrator, toOrchestrator, amountWei, unbondingPeriodDays }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Simulation failed');
      }
      const json = await res.json();
      setResult(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSimulating(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, isSimulating, error, simulate, reset };
}

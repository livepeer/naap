/**
 * Hook for Multi-Orchestrator Distribution Simulator
 */

import { useState, useCallback } from 'react';
import { getApiUrl } from '../App';

export interface MultiOInput {
  amountLpt: number;
  durationMonths: number;
  expectedReturnMin: number;
  expectedReturnMax: number;
}

export interface OrchestratorAllocation {
  address: string;
  name: string | null;
  rewardCut: number;
  totalStake: string;
  healthScore: number;
  allocationPct: number;
  allocationLpt: number;
  projectedApr: number;
  rationale: string;
}

export interface Strategy {
  riskLevel: 'high' | 'medium' | 'low';
  label: string;
  projectedApr: number;
  projectedReturn: number;
  allocations: OrchestratorAllocation[];
  riskFactors: string[];
}

export interface MultiOResult {
  input: MultiOInput;
  strategies: [Strategy, Strategy, Strategy];
  networkAvgApr: number;
  priceAtSimulation: { lptUsd: number };
}

export function useMultiOSimulator() {
  const [result, setResult] = useState<MultiOResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (input: MultiOInput) => {
    setIsSimulating(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/simulator/multi-orchestrator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setResult(json.data);
    } catch (err: any) {
      setError(err.message || 'Failed to simulate');
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

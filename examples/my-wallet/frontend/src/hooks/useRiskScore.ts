/**
 * Risk score hook (S16)
 */

import { useState, useCallback } from 'react';
import { getApiUrl } from '../App';

interface RiskScore {
  orchestratorAddr: string;
  overallScore: number;
  factors: {
    rewardConsistency: number;
    stakeConcentration: number;
    tenure: number;
    feeShareStability: number;
  };
  grade: string;
  details: string[];
}

export function useRiskScore() {
  const [scores, setScores] = useState<Record<string, RiskScore>>({});
  const [isLoading, setIsLoading] = useState(false);

  const fetchScore = useCallback(async (address: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `${getApiUrl()}/orchestrators/risk-score?address=${encodeURIComponent(address)}`,
      );
      if (res.ok) {
        const json = await res.json();
        setScores(prev => ({ ...prev, [address]: json.data }));
      }
    } catch (err) {
      console.error('Failed to fetch risk score:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { scores, isLoading, fetchScore };
}

/**
 * AI recommendation hook (S19)
 */

import { useState, useCallback } from 'react';
import { getApiUrl } from '../App';

interface OrchestratorRecommendation {
  address: string;
  name: string | null;
  score: number;
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  isActive: boolean;
  reasons: string[];
}

type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';
type TargetYield = 'low' | 'medium' | 'high';

export function useAiRecommend() {
  const [recommendations, setRecommendations] = useState<OrchestratorRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchRecommendations = useCallback(async (
    riskTolerance: RiskTolerance = 'moderate',
    targetYield: TargetYield = 'medium',
    diversify = true,
  ) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/ai/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: { riskTolerance, targetYield, diversify },
          limit: 5,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setRecommendations(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch recommendations:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { recommendations, isLoading, fetchRecommendations };
}

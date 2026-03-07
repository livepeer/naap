/**
 * Governance hook (S18)
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';
import { useWallet } from '../context/WalletContext';

interface GovernanceVote {
  orchestratorAddr: string;
  support: boolean;
  weight: string;
}

interface GovernanceProposal {
  id: string;
  proposalId: string;
  title: string;
  description: string | null;
  status: string;
  votesFor: string;
  votesAgainst: string;
  createdAt: string;
  votes: GovernanceVote[];
}

interface OrchestratorGovernance {
  orchestratorAddr: string;
  totalProposals: number;
  totalVotes: number;
  participationRate: number;
  votesFor: number;
  votesAgainst: number;
}

export function useGovernance() {
  const { isConnected } = useWallet();
  const [proposals, setProposals] = useState<GovernanceProposal[]>([]);
  const [myOrchestrators, setMyOrchestrators] = useState<OrchestratorGovernance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchProposals = useCallback(async (status?: string) => {
    setIsLoading(true);
    try {
      const params = status ? `?status=${status}` : '';
      const res = await fetch(`${getApiUrl()}/governance/proposals${params}`);
      if (res.ok) {
        const json = await res.json();
        setProposals(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch proposals:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchMyOrchestrators = useCallback(async () => {
    if (!isConnected) return;
    try {
      const res = await fetch(`${getApiUrl()}/governance/my-orchestrators`);
      if (res.ok) {
        const json = await res.json();
        setMyOrchestrators(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch orchestrator governance:', err);
    }
  }, [isConnected]);

  useEffect(() => {
    fetchProposals();
    fetchMyOrchestrators();
  }, [fetchProposals, fetchMyOrchestrators]);

  return { proposals, myOrchestrators, isLoading, fetchProposals, fetchMyOrchestrators };
}

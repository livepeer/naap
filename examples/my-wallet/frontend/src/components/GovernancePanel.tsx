/**
 * Governance tracking panel (S18)
 */

import React from 'react';
import { Vote, CheckCircle, XCircle } from 'lucide-react';

interface GovernanceVote {
  orchestratorAddr: string;
  support: boolean;
  weight: string;
}

interface GovernanceProposal {
  id: string;
  proposalId: string;
  title: string;
  status: string;
  votesFor: string;
  votesAgainst: string;
  createdAt: string;
  votes: GovernanceVote[];
}

interface OrchestratorGovernance {
  orchestratorAddr: string;
  totalVotes: number;
  participationRate: number;
  votesFor: number;
  votesAgainst: number;
}

interface GovernancePanelProps {
  proposals: GovernanceProposal[];
  myOrchestrators: OrchestratorGovernance[];
  isLoading?: boolean;
}

export const GovernancePanel: React.FC<GovernancePanelProps> = ({
  proposals,
  myOrchestrators,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="glass-card p-6 animate-pulse">
        <div className="h-5 bg-bg-tertiary rounded w-40 mb-4" />
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-20 bg-bg-tertiary rounded" />)}
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-accent-blue bg-accent-blue/10';
      case 'passed': return 'text-accent-emerald bg-accent-emerald/10';
      case 'defeated': return 'text-accent-rose bg-accent-rose/10';
      case 'executed': return 'text-accent-purple bg-accent-purple/10';
      default: return 'text-text-muted bg-bg-tertiary';
    }
  };

  return (
    <div className="glass-card p-6" role="region" aria-label="Governance tracking">
      <div className="flex items-center gap-2 mb-4">
        <Vote className="w-5 h-5 text-accent-purple" />
        <h3 className="text-sm font-semibold text-text-secondary">Governance</h3>
      </div>

      {/* My Orchestrators' Participation */}
      {myOrchestrators.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-text-muted mb-2">Your Orchestrators' Participation</p>
          <div className="flex flex-wrap gap-2">
            {myOrchestrators.map(o => (
              <div key={o.orchestratorAddr} className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-xs">
                <span className="font-mono">{o.orchestratorAddr.slice(0, 8)}...</span>
                <span className={`ml-2 font-bold ${o.participationRate > 50 ? 'text-accent-emerald' : 'text-accent-amber'}`}>
                  {o.participationRate.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Proposals */}
      {proposals.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-4">No governance proposals found</p>
      ) : (
        <div className="space-y-2">
          {proposals.slice(0, 5).map(p => (
            <div key={p.id} className="p-3 bg-bg-tertiary rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-text-primary truncate flex-1">{p.title}</p>
                <span className={`text-xs px-2 py-0.5 rounded capitalize ml-2 ${getStatusColor(p.status)}`}>
                  {p.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-accent-emerald" />
                  For: {p.votes.filter(v => v.support).length}
                </span>
                <span className="flex items-center gap-1">
                  <XCircle className="w-3 h-3 text-accent-rose" />
                  Against: {p.votes.filter(v => !v.support).length}
                </span>
                <span>{new Date(p.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

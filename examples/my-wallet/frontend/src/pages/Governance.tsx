/**
 * Governance Page (S18)
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useGovernance } from '../hooks/useGovernance';
import { PageHeader } from '../components/PageHeader';
import { GovernancePanel } from '../components/GovernancePanel';

export const GovernancePage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected } = useWallet();
  const governance = useGovernance();

  React.useEffect(() => {
    if (!isConnected) navigate('/');
  }, [isConnected, navigate]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance"
        subtitle="Track proposals and how your orchestrators vote"
      />
      <GovernancePanel
        proposals={governance.proposals}
        myOrchestrators={governance.myOrchestrators}
        isLoading={governance.isLoading}
      />
    </div>
  );
};

/**
 * Rebalancing Simulator Page (S8)
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useSimulator } from '../hooks/useSimulator';
import { PageHeader } from '../components/PageHeader';
import { SimulatorPanel } from '../components/SimulatorPanel';

export const SimulatorPage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected } = useWallet();
  const simulator = useSimulator();

  React.useEffect(() => {
    if (!isConnected) navigate('/');
  }, [isConnected, navigate]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rebalancing Simulator"
        subtitle="What-if analysis for moving stake between orchestrators"
      />
      <SimulatorPanel
        result={simulator.result}
        isSimulating={simulator.isSimulating}
        error={simulator.error}
        onSimulate={simulator.simulate}
        onReset={simulator.reset}
      />
    </div>
  );
};

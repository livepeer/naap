/**
 * Watchlist Page (S15)
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useWatchlist } from '../hooks/useWatchlist';
import { PageHeader } from '../components/PageHeader';
import { WatchlistPanel } from '../components/WatchlistPanel';

export const WatchlistPage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected } = useWallet();
  const watchlist = useWatchlist();

  React.useEffect(() => {
    if (!isConnected) navigate('/');
  }, [isConnected, navigate]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Watchlist"
        subtitle="Monitor orchestrator candidates before delegating"
      />
      <WatchlistPanel
        items={watchlist.items}
        isLoading={watchlist.isLoading}
        onAdd={watchlist.add}
        onRemove={watchlist.remove}
        onUpdate={watchlist.update}
        onCompare={(addr) => navigate(`/compare?address=${addr}`)}
      />
    </div>
  );
};

/**
 * Dashboard Page - Wallet overview
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, TrendingUp, ArrowUpRight, ArrowDownLeft, RefreshCw, ExternalLink } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { useStaking } from '../hooks/useStaking';
import { useTransactions } from '../hooks/useTransactions';
import { formatAddress, formatBalance, getExplorerAddressUrl } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { address, chainId, balance, isConnected, networkName, disconnect } = useWallet();
  const { lptBalance, stakedAmount, pendingRewards, pendingFees, delegatedTo, isLoading: stakingLoading, refreshStakingState } = useStaking();
  const { transactions } = useTransactions(5);

  if (!isConnected || !address) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary">Please connect your wallet first</p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 px-6 py-2 bg-accent-purple text-white rounded-lg font-medium"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Back Navigation */}
      <PageHeader
        title="Wallet Dashboard"
        subtitle={networkName || `Chain ${chainId}`}
        actions={
          <>
            <button
              onClick={() => refreshStakingState()}
              disabled={stakingLoading}
              className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-secondary transition-colors"
            >
              <RefreshCw className={`w-5 h-5 text-text-secondary ${stakingLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={disconnect}
              className="px-4 py-2 text-sm text-accent-rose border border-accent-rose/30 rounded-lg hover:bg-accent-rose/10 transition-colors"
            >
              Disconnect
            </button>
          </>
        }
      />

      {/* Account Info */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full wallet-gradient flex items-center justify-center">
              <Wallet className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Connected Address</p>
              <p className="text-lg font-mono font-semibold text-text-primary">{formatAddress(address, 8)}</p>
            </div>
          </div>
          <a
            href={chainId ? getExplorerAddressUrl(chainId, address) : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-accent-blue hover:underline"
          >
            View on Explorer
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BalanceCard
          title="ETH Balance"
          value={balance ? formatBalance(balance) : '0'}
          symbol="ETH"
          icon={<Wallet className="w-5 h-5" />}
        />
        <BalanceCard
          title="LPT Balance"
          value={formatBalance(lptBalance)}
          symbol="LPT"
          icon={<TrendingUp className="w-5 h-5" />}
          onClick={() => navigate('/staking')}
        />
        <BalanceCard
          title="Staked LPT"
          value={formatBalance(stakedAmount)}
          symbol="LPT"
          icon={<TrendingUp className="w-5 h-5" />}
          accent
          onClick={() => navigate('/staking')}
        />
      </div>

      {/* Staking Summary */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Staking Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-text-secondary">Delegated To</p>
            <p className="font-mono text-text-primary">
              {delegatedTo ? formatAddress(delegatedTo, 6) : 'Not delegated'}
            </p>
          </div>
          <div>
            <p className="text-sm text-text-secondary">Pending Rewards</p>
            <p className="font-semibold text-accent-emerald">
              {formatBalance(pendingRewards)} LPT
            </p>
          </div>
          <div>
            <p className="text-sm text-text-secondary">Pending Fees</p>
            <p className="font-semibold text-accent-blue">
              {formatBalance(pendingFees)} ETH
            </p>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => navigate('/staking')}
              className="px-4 py-2 bg-accent-purple text-white rounded-lg font-medium hover:bg-accent-purple/90 transition-colors"
            >
              Manage Staking
            </button>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Recent Activity</h2>
          <button
            onClick={() => navigate('/transactions')}
            className="text-sm text-accent-blue hover:underline"
          >
            View All
          </button>
        </div>
        
        {transactions.length === 0 ? (
          <p className="text-text-secondary text-center py-8">No recent transactions</p>
        ) : (
          <div className="space-y-3">
            {transactions.slice(0, 5).map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    tx.type === 'stake' ? 'bg-accent-emerald/20' : 'bg-accent-blue/20'
                  }`}>
                    {tx.type === 'stake' ? (
                      <ArrowUpRight className="w-4 h-4 text-accent-emerald" />
                    ) : (
                      <ArrowDownLeft className="w-4 h-4 text-accent-blue" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-text-primary capitalize">{tx.type}</p>
                    <p className="text-xs text-text-secondary">
                      {new Date(tx.timestamp).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${tx.status === 'confirmed' ? 'text-accent-emerald' : tx.status === 'failed' ? 'text-accent-rose' : 'text-accent-amber'}`}>
                    {tx.status}
                  </p>
                  {tx.value && (
                    <p className="text-xs text-text-secondary">{formatBalance(tx.value)} LPT</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Balance Card Component
interface BalanceCardProps {
  title: string;
  value: string;
  symbol: string;
  icon: React.ReactNode;
  accent?: boolean;
  onClick?: () => void;
}

const BalanceCard: React.FC<BalanceCardProps> = ({ title, value, symbol, icon, accent, onClick }) => (
  <div
    onClick={onClick}
    className={`glass-card p-5 ${onClick ? 'cursor-pointer hover:border-accent-purple/50' : ''} ${accent ? 'border-accent-purple/30' : ''}`}
  >
    <div className="flex items-center justify-between mb-3">
      <span className="text-text-secondary text-sm">{title}</span>
      <span className={accent ? 'text-accent-purple' : 'text-text-secondary'}>{icon}</span>
    </div>
    <p className="text-2xl font-bold text-text-primary">
      {value} <span className="text-lg text-text-secondary">{symbol}</span>
    </p>
  </div>
);

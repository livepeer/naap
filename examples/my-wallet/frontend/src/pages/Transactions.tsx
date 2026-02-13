/**
 * Transactions Page - Transaction history
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  Gift, 
  Send, 
  RefreshCw, 
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { useTransactions, Transaction } from '../hooks/useTransactions';
import { PageHeader } from '../components/PageHeader';
import { formatTxHash, formatBalance, getExplorerTxUrl } from '../lib/utils';

export const TransactionsPage: React.FC = () => {
  const navigate = useNavigate();
  const { address, chainId, isConnected } = useWallet();
  const { transactions, isLoading, error, refresh, hasMore, loadMore, total } = useTransactions(20);

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

  const getTypeIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'stake':
        return <ArrowUpRight className="w-4 h-4 text-accent-emerald" />;
      case 'unstake':
        return <ArrowDownLeft className="w-4 h-4 text-accent-amber" />;
      case 'claim':
        return <Gift className="w-4 h-4 text-accent-purple" />;
      case 'transfer':
        return <Send className="w-4 h-4 text-accent-blue" />;
      default:
        return <Clock className="w-4 h-4 text-text-secondary" />;
    }
  };

  const getStatusIcon = (status: Transaction['status']) => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="w-4 h-4 text-accent-emerald" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-accent-rose" />;
      case 'pending':
      default:
        return <Clock className="w-4 h-4 text-accent-amber animate-pulse" />;
    }
  };

  const getTypeColor = (type: Transaction['type']) => {
    switch (type) {
      case 'stake':
        return 'bg-accent-emerald/20';
      case 'unstake':
        return 'bg-accent-amber/20';
      case 'claim':
        return 'bg-accent-purple/20';
      case 'transfer':
        return 'bg-accent-blue/20';
      default:
        return 'bg-bg-tertiary';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Back Navigation */}
      <PageHeader
        title="Transaction History"
        subtitle={total > 0 ? `${total} transactions` : 'No transactions yet'}
        actions={
          <button
            onClick={refresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary rounded-lg hover:bg-bg-secondary transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {/* Error State */}
      {error && (
        <div className="p-4 bg-accent-rose/10 border border-accent-rose/30 rounded-lg text-accent-rose">
          {error}
        </div>
      )}

      {/* Transactions List */}
      <div className="glass-card divide-y divide-white/5">
        {transactions.length === 0 && !isLoading ? (
          <div className="p-12 text-center">
            <Clock className="w-12 h-12 text-text-secondary mx-auto mb-4" />
            <p className="text-text-secondary">No transactions found</p>
            <p className="text-sm text-text-secondary mt-1">
              Your transaction history will appear here
            </p>
          </div>
        ) : (
          <>
            {transactions.map(tx => (
              <div key={tx.id} className="p-4 hover:bg-bg-tertiary/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Type Icon */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getTypeColor(tx.type)}`}>
                      {getTypeIcon(tx.type)}
                    </div>

                    {/* Transaction Details */}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-text-primary capitalize">{tx.type}</p>
                        {getStatusIcon(tx.status)}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-text-secondary">
                        <span className="font-mono">{formatTxHash(tx.txHash)}</span>
                        <span>•</span>
                        <span>{new Date(tx.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Amount and Actions */}
                  <div className="flex items-center gap-4">
                    {tx.value && (
                      <div className="text-right">
                        <p className={`font-semibold ${
                          tx.type === 'stake' || tx.type === 'transfer' ? 'text-accent-rose' : 'text-accent-emerald'
                        }`}>
                          {tx.type === 'stake' || tx.type === 'transfer' ? '-' : '+'}
                          {formatBalance(tx.value)} LPT
                        </p>
                        {tx.gasUsed && (
                          <p className="text-xs text-text-secondary">
                            Gas: {formatBalance(tx.gasUsed, 9, 6)} Gwei
                          </p>
                        )}
                      </div>
                    )}

                    {chainId && (
                      <a
                        href={getExplorerTxUrl(chainId, tx.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-secondary transition-colors"
                      >
                        <ExternalLink className="w-4 h-4 text-text-secondary" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Load More */}
            {hasMore && (
              <div className="p-4 text-center">
                <button
                  onClick={loadMore}
                  disabled={isLoading}
                  className="px-6 py-2 text-accent-purple hover:underline disabled:opacity-50"
                >
                  {isLoading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Loading Overlay */}
      {isLoading && transactions.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-accent-purple animate-spin" />
        </div>
      )}
    </div>
  );
};

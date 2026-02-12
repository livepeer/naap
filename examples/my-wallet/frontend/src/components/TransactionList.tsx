/**
 * TransactionList - Display list of transactions
 */

import React from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Gift,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
} from 'lucide-react';
import { Transaction } from '../hooks/useTransactions';
import { formatTxHash, formatBalance, getExplorerTxUrl } from '../lib/utils';

interface TransactionListProps {
  transactions: Transaction[];
  chainId?: number | null;
  maxItems?: number;
  showLoadMore?: boolean;
  onLoadMore?: () => void;
  isLoading?: boolean;
}

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  chainId,
  maxItems,
  showLoadMore = false,
  onLoadMore,
  isLoading = false,
}) => {
  const displayTransactions = maxItems
    ? transactions.slice(0, maxItems)
    : transactions;

  if (transactions.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock className="w-10 h-10 text-text-secondary mx-auto mb-3" />
        <p className="text-text-secondary">No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {displayTransactions.map(tx => (
        <TransactionRow key={tx.id} transaction={tx} chainId={chainId} />
      ))}

      {showLoadMore && onLoadMore && (
        <button
          onClick={onLoadMore}
          disabled={isLoading}
          className="w-full py-3 text-center text-accent-purple hover:underline disabled:opacity-50"
        >
          {isLoading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
};

interface TransactionRowProps {
  transaction: Transaction;
  chainId?: number | null;
}

const TransactionRow: React.FC<TransactionRowProps> = ({ transaction, chainId }) => {
  const { txHash, type, status, value, timestamp } = transaction;

  const getTypeIcon = () => {
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

  const getStatusIcon = () => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="w-3 h-3 text-accent-emerald" />;
      case 'failed':
        return <XCircle className="w-3 h-3 text-accent-rose" />;
      case 'pending':
      default:
        return <Clock className="w-3 h-3 text-accent-amber animate-pulse" />;
    }
  };

  const getTypeColor = () => {
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
    <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg hover:bg-bg-secondary transition-colors">
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${getTypeColor()}`}>
          {getTypeIcon()}
        </div>

        {/* Details */}
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary capitalize">{type}</span>
            {getStatusIcon()}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="font-mono">{formatTxHash(txHash, 6)}</span>
            <span>•</span>
            <span>{formatTime(timestamp)}</span>
          </div>
        </div>
      </div>

      {/* Amount and Explorer Link */}
      <div className="flex items-center gap-3">
        {value && (
          <span className={`font-medium ${
            type === 'stake' || type === 'transfer' ? 'text-accent-rose' : 'text-accent-emerald'
          }`}>
            {type === 'stake' || type === 'transfer' ? '-' : '+'}
            {formatBalance(value)}
          </span>
        )}

        {chainId && (
          <a
            href={getExplorerTxUrl(chainId, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg hover:bg-bg-tertiary transition-colors"
            title="View on explorer"
          >
            <ExternalLink className="w-4 h-4 text-text-secondary" />
          </a>
        )}
      </div>
    </div>
  );
};

// Helper to format timestamp
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}

export default TransactionList;

/**
 * AccountInfo - Display wallet account information
 */

import React from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { formatAddress, formatBalance, getExplorerAddressUrl } from '../lib/utils';

interface AccountInfoProps {
  showBalance?: boolean;
  showNetwork?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const AccountInfo: React.FC<AccountInfoProps> = ({
  showBalance = true,
  showNetwork = true,
  size = 'md',
}) => {
  const { address, chainId, balance, networkName, isConnected } = useWallet();
  const [copied, setCopied] = React.useState(false);

  if (!isConnected || !address) {
    return null;
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sizeClasses = {
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  };

  const iconSizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
  };

  const innerIconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-7 h-7',
  };

  const addressChars = {
    sm: 4,
    md: 6,
    lg: 8,
  };

  return (
    <div className={`glass-card ${sizeClasses[size]}`}>
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div className={`${iconSizes[size]} rounded-full wallet-gradient flex items-center justify-center flex-shrink-0`}>
          <span className={`${innerIconSizes[size]} text-white font-bold`}>
            {address.slice(2, 4).toUpperCase()}
          </span>
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-mono font-semibold text-text-primary truncate">
              {formatAddress(address, addressChars[size])}
            </p>
            <button
              onClick={handleCopy}
              className="p-1 hover:bg-bg-tertiary rounded transition-colors flex-shrink-0"
              title={copied ? 'Copied!' : 'Copy address'}
            >
              {copied ? (
                <Check className="w-4 h-4 text-accent-emerald" />
              ) : (
                <Copy className="w-4 h-4 text-text-secondary" />
              )}
            </button>
            {chainId && (
              <a
                href={getExplorerAddressUrl(chainId, address)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-bg-tertiary rounded transition-colors flex-shrink-0"
                title="View on explorer"
              >
                <ExternalLink className="w-4 h-4 text-text-secondary" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1">
            {showNetwork && networkName && (
              <span className="text-xs px-2 py-0.5 bg-accent-emerald/20 text-accent-emerald rounded-full">
                {networkName}
              </span>
            )}
            {showBalance && balance !== null && (
              <span className="text-sm text-text-secondary">
                {formatBalance(balance)} ETH
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountInfo;

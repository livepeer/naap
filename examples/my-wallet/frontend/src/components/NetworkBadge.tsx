/**
 * NetworkBadge - Display current network status
 */

import React from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { useWallet } from '../context/WalletContext';

interface NetworkBadgeProps {
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const NetworkBadge: React.FC<NetworkBadgeProps> = ({
  showIcon = true,
  size = 'md',
}) => {
  const { chainId, networkName, isConnected, isSupportedNetwork } = useWallet();

  if (!isConnected) {
    return null;
  }

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full ${sizeClasses[size]} ${
        isSupportedNetwork
          ? 'bg-accent-emerald/20 text-accent-emerald'
          : 'bg-accent-amber/20 text-accent-amber'
      }`}
    >
      {showIcon && (
        isSupportedNetwork ? (
          <CheckCircle className={iconSizes[size]} />
        ) : (
          <AlertTriangle className={iconSizes[size]} />
        )
      )}
      <span className="font-medium">
        {networkName || `Chain ${chainId}`}
      </span>
    </div>
  );
};

export default NetworkBadge;

/**
 * PriceDisplay - Shows LPT/ETH amount + USD equivalent
 */

import React from 'react';

interface PriceDisplayProps {
  amount: string;
  symbol: 'LPT' | 'ETH';
  priceUsd: number;
  showUsd?: boolean;
  className?: string;
}

export const PriceDisplay: React.FC<PriceDisplayProps> = ({
  amount,
  symbol,
  priceUsd,
  showUsd = true,
  className = '',
}) => {
  const numAmount = parseFloat(amount) || 0;
  const formatted = numAmount > 1e15
    ? `${(numAmount / 1e18).toFixed(4)}`
    : numAmount.toLocaleString(undefined, { maximumFractionDigits: 4 });

  const usdValue = priceUsd > 0 ? (numAmount / 1e18) * priceUsd : 0;

  return (
    <span className={`inline-flex flex-col ${className}`}>
      <span className="font-mono text-text-primary">
        {formatted} {symbol}
      </span>
      {showUsd && priceUsd > 0 && (
        <span className="text-xs font-mono text-text-muted">
          ${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
    </span>
  );
};

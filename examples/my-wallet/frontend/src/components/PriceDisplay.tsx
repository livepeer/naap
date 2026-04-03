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
  let lptValue: number;
  let formatted: string;
  try {
    const wei = BigInt(amount.split('.')[0]);
    const WEI = 10n ** 18n;
    const whole = wei / WEI;
    const frac = ((wei % WEI) * 10000n) / WEI;
    lptValue = Number(whole) + Number(frac) / 10000;
    formatted = lptValue.toLocaleString(undefined, { maximumFractionDigits: 4 });
  } catch {
    lptValue = parseFloat(amount) || 0;
    formatted = lptValue.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  const usdValue = priceUsd > 0 ? lptValue * priceUsd : 0;

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

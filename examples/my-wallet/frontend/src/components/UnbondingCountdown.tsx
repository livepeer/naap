/**
 * UnbondingCountdown - Real-time countdown display for unbonding locks
 */

import React from 'react';
import { useRoundCountdown } from '../hooks/useRoundCountdown';

interface UnbondingCountdownProps {
  currentRound: number;
  withdrawRound: number;
  roundLength?: number;
  compact?: boolean;
}

export const UnbondingCountdown: React.FC<UnbondingCountdownProps> = ({
  currentRound,
  withdrawRound,
  roundLength = 5760,
  compact = false,
}) => {
  const { days, hours, minutes, seconds, percentComplete, isReady } = useRoundCountdown(
    currentRound,
    withdrawRound,
    roundLength
  );

  if (isReady) {
    return (
      <div className={compact ? 'inline-flex' : ''}>
        <span className="text-sm font-semibold text-accent-emerald">READY</span>
      </div>
    );
  }

  if (compact) {
    return (
      <span className="font-mono text-sm text-amber-500">
        {days > 0 ? `${days}d ` : ''}{hours}h {minutes}m
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg text-text-primary">
          {days > 0 && <>{days}<span className="text-text-secondary text-sm">d</span> </>}
          {hours}<span className="text-text-secondary text-sm">h</span>{' '}
          {minutes}<span className="text-text-secondary text-sm">m</span>{' '}
          {seconds}<span className="text-text-secondary text-sm">s</span>
        </span>
      </div>
      <div className="w-full bg-bg-tertiary rounded-full h-1.5">
        <div
          className="bg-accent-purple h-1.5 rounded-full transition-all duration-1000"
          style={{ width: `${percentComplete}%` }}
        />
      </div>
      <p className="text-xs text-text-secondary">
        Round {withdrawRound} ({Math.round(percentComplete)}% complete)
      </p>
    </div>
  );
};

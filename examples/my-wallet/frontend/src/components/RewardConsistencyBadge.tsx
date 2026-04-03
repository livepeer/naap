/**
 * Reward consistency badge for orchestrator cards (S9)
 */

import React from 'react';
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface RewardConsistencyBadgeProps {
  callRate: number;
  currentMissStreak: number;
  totalRounds: number;
  compact?: boolean;
}

export const RewardConsistencyBadge: React.FC<RewardConsistencyBadgeProps> = ({
  callRate,
  currentMissStreak,
  totalRounds,
  compact = false,
}) => {
  let color: string;
  let Icon: typeof CheckCircle;
  let label: string;

  if (totalRounds < 5) {
    color = 'text-text-muted';
    Icon = AlertTriangle;
    label = 'New';
  } else if (callRate >= 95) {
    color = 'text-accent-emerald';
    Icon = CheckCircle;
    label = 'Reliable';
  } else if (callRate >= 80) {
    color = 'text-accent-amber';
    Icon = AlertTriangle;
    label = 'Fair';
  } else {
    color = 'text-accent-rose';
    Icon = XCircle;
    label = 'Unreliable';
  }

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs ${color}`} title={`${callRate}% reward call rate`}>
        <Icon className="w-3 h-3" />
        {callRate.toFixed(0)}%
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bg-tertiary ${color}`}>
      <Icon className="w-4 h-4" />
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs font-mono">{callRate.toFixed(1)}%</span>
      {currentMissStreak > 0 && (
        <span className="text-xs text-accent-rose">({currentMissStreak} missed)</span>
      )}
    </div>
  );
};

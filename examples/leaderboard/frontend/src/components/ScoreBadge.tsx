import React from 'react';

export interface ScoreBadgeProps {
  score: number;
}

export const ScoreBadge: React.FC<ScoreBadgeProps> = ({ score }) => {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.9
      ? 'text-emerald-400 bg-emerald-500/10'
      : score >= 0.7
        ? 'text-amber-400 bg-amber-500/10'
        : 'text-red-400 bg-red-500/10';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}
    >
      {pct}%
    </span>
  );
};

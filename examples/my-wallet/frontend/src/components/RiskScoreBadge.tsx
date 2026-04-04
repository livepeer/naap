/**
 * Risk score badge component (S16)
 */

import React from 'react';
import { Shield } from 'lucide-react';

interface RiskScoreBadgeProps {
  grade: string;
  score: number;
  factors?: {
    rewardConsistency: number;
    stakeConcentration: number;
    tenure: number;
    feeShareStability: number;
  };
  details?: string[];
  expanded?: boolean;
}

export const RiskScoreBadge: React.FC<RiskScoreBadgeProps> = ({
  grade,
  score,
  factors,
  details,
  expanded = false,
}) => {
  const gradeColor: Record<string, string> = {
    A: 'text-accent-emerald bg-accent-emerald/10 border-accent-emerald/30',
    B: 'text-accent-blue bg-accent-blue/10 border-accent-blue/30',
    C: 'text-accent-amber bg-accent-amber/10 border-accent-amber/30',
    D: 'text-accent-rose bg-accent-rose/10 border-accent-rose/30',
    F: 'text-accent-rose bg-accent-rose/20 border-accent-rose/50',
  };

  const colorClass = gradeColor[grade] || 'text-text-muted bg-bg-tertiary border-white/10';

  if (!expanded) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${colorClass}`}
        title={`Risk score: ${score}/100`}
      >
        <Shield className="w-3 h-3" />
        {grade}
      </span>
    );
  }

  return (
    <div className={`p-4 rounded-lg border ${colorClass}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          <span className="text-lg font-bold">Grade {grade}</span>
        </div>
        <span className="text-sm font-mono">{score}/100</span>
      </div>

      {factors && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {([
            ['Reward Consistency', factors.rewardConsistency, 25],
            ['Stake Size', factors.stakeConcentration, 25],
            ['Tenure', factors.tenure, 25],
            ['Stability', factors.feeShareStability, 25],
          ] as const).map(([label, value, max]) => (
            <div key={label} className="text-xs">
              <div className="flex justify-between mb-1">
                <span>{label}</span>
                <span className="font-mono">{value}/{max}</span>
              </div>
              <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-current rounded-full"
                  style={{ width: `${(value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {details && details.length > 0 && (
        <div className="text-xs space-y-1 border-t border-current/20 pt-2">
          {details.map((d, i) => (
            <p key={i} className="opacity-75">• {d}</p>
          ))}
        </div>
      )}
    </div>
  );
};

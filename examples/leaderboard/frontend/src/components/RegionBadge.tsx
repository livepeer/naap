import React from 'react';

const REGION_COLORS: Record<string, string> = {
  SEA: 'bg-blue-500/15 text-blue-400',
  FRA: 'bg-violet-500/15 text-violet-400',
  MDW: 'bg-amber-500/15 text-amber-400',
};

export interface RegionBadgeProps {
  region: string;
}

export const RegionBadge: React.FC<RegionBadgeProps> = ({ region }) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${REGION_COLORS[region] || 'bg-muted text-muted-foreground'}`}
  >
    {region}
  </span>
);

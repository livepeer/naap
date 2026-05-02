import React from 'react';
import type { NextMoment } from './types';

interface Props {
  days: { date: string; cents: number }[];
  moments: NextMoment[];
  width?: number;
  height?: number;
}

export const CashflowTimeline: React.FC<Props> = ({ days, moments, width = 320, height = 60 }) => {
  const visible = moments.filter(m => m.daysOut >= 0 && m.daysOut <= 30);
  const padX = 8;
  const innerW = width - padX * 2;
  const yMid = height / 2;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="30-day cashflow">
      <line x1={padX} x2={width - padX} y1={yMid} y2={yMid} stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      <circle cx={padX} cy={yMid} r={4} fill="currentColor" />
      <circle cx={width - padX} cy={yMid} r={4} fill="currentColor" />
      {visible.map((m, i) => {
        const x = padX + (m.daysOut / 30) * innerW;
        const isInflow = m.kind === 'income';
        const color = isInflow ? '#22c55e' : '#ef4444';
        return (
          <g key={i} data-testid="timeline-marker" aria-label={m.label}>
            <line x1={x} x2={x} y1={yMid - 12} y2={yMid + 12} stroke={color} strokeWidth={2} />
            <circle cx={x} cy={isInflow ? yMid - 12 : yMid + 12} r={5} fill={color} />
          </g>
        );
      })}
    </svg>
  );
};

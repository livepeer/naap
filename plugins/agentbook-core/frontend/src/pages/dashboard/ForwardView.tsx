import React from 'react';
import { CashflowTimeline } from './CashflowTimeline';
import { NextMomentsList } from './NextMomentsList';
import type { NextMoment } from './types';

interface Props {
  cashTodayCents: number;
  projection: { days: { date: string; cents: number }[]; moodLabel: 'healthy' | 'tight' | 'critical' } | null;
  moments: NextMoment[];
}

const moodIcon = (label: 'healthy' | 'tight' | 'critical') =>
  label === 'healthy' ? '☀️' : label === 'tight' ? '⛅' : '⛈';

const moodText = (label: 'healthy' | 'tight' | 'critical') =>
  label === 'healthy' ? 'Healthy' : label === 'tight' ? 'Tight' : 'Critical';

const fmt = (cents: number) =>
  '$' + Math.round(cents / 100).toLocaleString('en-US');

export const ForwardView: React.FC<Props> = ({ cashTodayCents, projection, moments }) => {
  const projectedEnd = projection?.days[projection.days.length - 1]?.cents ?? cashTodayCents;
  const endDate = projection?.days[projection.days.length - 1]?.date;

  return (
    <section className="bg-card border border-border rounded-2xl p-4 sm:p-6">
      <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-lg sm:text-xl font-bold text-foreground">
          {fmt(cashTodayCents)} today → {fmt(projectedEnd)} {endDate && new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </h2>
        {projection && (
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {moodIcon(projection.moodLabel)} {moodText(projection.moodLabel)}
          </span>
        )}
      </div>
      <div className="text-foreground mb-4">
        <CashflowTimeline days={projection?.days || []} moments={moments} />
        <div className="flex justify-between text-xs text-muted-foreground mt-1 px-2">
          <span>Today</span><span>+30d</span>
        </div>
      </div>
      <NextMomentsList moments={moments} />
    </section>
  );
};

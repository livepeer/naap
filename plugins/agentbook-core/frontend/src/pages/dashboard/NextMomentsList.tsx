import React from 'react';
import type { NextMoment } from './types';

interface Props { moments: NextMoment[]; }

export const NextMomentsList: React.FC<Props> = ({ moments }) => {
  if (moments.length === 0) {
    return <p className="text-sm text-muted-foreground">No upcoming receivables or bills.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {moments.map((m, i) => (
        <li key={i} className="text-sm font-medium text-foreground">{m.label}</li>
      ))}
    </ul>
  );
};

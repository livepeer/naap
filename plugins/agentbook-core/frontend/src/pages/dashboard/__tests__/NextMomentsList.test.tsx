import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextMomentsList } from '../NextMomentsList';
import type { NextMoment } from '../types';

describe('NextMomentsList', () => {
  it('renders all items with their labels', () => {
    const moments: NextMoment[] = [
      { kind: 'rent', label: '🏠 Rent $1,800 in 5d', amountCents: 180000, daysOut: 5 },
      { kind: 'income', label: '💰 Acme $4,500 in 7d', amountCents: 450000, daysOut: 7 },
    ];
    render(<NextMomentsList moments={moments} />);
    expect(screen.getByText(/Rent/)).toBeInTheDocument();
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
  });

  it('shows empty state when no moments', () => {
    render(<NextMomentsList moments={[]} />);
    expect(screen.getByText(/No upcoming/i)).toBeInTheDocument();
  });
});

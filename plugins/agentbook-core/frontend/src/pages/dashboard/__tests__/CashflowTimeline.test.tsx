import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CashflowTimeline } from '../CashflowTimeline';
import type { NextMoment } from '../types';

const baseDays = Array.from({ length: 30 }, (_, i) => ({
  date: '2026-05-' + String(i + 1).padStart(2, '0'),
  cents: 100000 + i * 1000,
}));

describe('CashflowTimeline', () => {
  it('renders one circle per marker', () => {
    const moments: NextMoment[] = [
      { kind: 'income', label: 'Acme', amountCents: 450000, daysOut: 7 },
      { kind: 'tax', label: 'Tax', amountCents: 320000, daysOut: 14 },
    ];
    const { container } = render(<CashflowTimeline days={baseDays} moments={moments} />);
    expect(container.querySelectorAll('[data-testid="timeline-marker"]').length).toBe(2);
  });

  it('clips markers with daysOut > 30', () => {
    const moments: NextMoment[] = [
      { kind: 'recurring', label: 'Far', amountCents: 100, daysOut: 45 },
    ];
    const { container } = render(<CashflowTimeline days={baseDays} moments={moments} />);
    expect(container.querySelectorAll('[data-testid="timeline-marker"]').length).toBe(0);
  });
});

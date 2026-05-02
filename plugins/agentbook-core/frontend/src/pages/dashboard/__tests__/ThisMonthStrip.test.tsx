import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThisMonthStrip, computeDelta } from '../ThisMonthStrip';

describe('computeDelta', () => {
  it('returns positive % when current > prior', () => {
    expect(computeDelta(11500, 10000)).toEqual({ pct: 15, sign: 'up' });
  });
  it('returns negative % when current < prior', () => {
    expect(computeDelta(9700, 10000)).toEqual({ pct: -3, sign: 'down' });
  });
  it('returns null when prior is 0 (avoids Infinity)', () => {
    expect(computeDelta(5000, 0)).toBe(null);
  });
});

describe('ThisMonthStrip', () => {
  it('renders all three numbers with deltas', () => {
    render(<ThisMonthStrip
      mtd={{ revenueCents: 1240000, expenseCents: 410000, netCents: 830000 }}
      prev={{ revenueCents: 1078260, expenseCents: 422680, netCents: 680320 }}
    />);
    expect(screen.getByText(/Rev/)).toBeInTheDocument();
    expect(screen.getByText(/Exp/)).toBeInTheDocument();
    expect(screen.getByText(/Net/)).toBeInTheDocument();
  });

  it('renders "—" instead of Infinity when prior is 0', () => {
    const { container } = render(<ThisMonthStrip
      mtd={{ revenueCents: 100000, expenseCents: 0, netCents: 100000 }}
      prev={{ revenueCents: 0, expenseCents: 0, netCents: 0 }}
    />);
    expect(container.textContent).not.toMatch(/Infinity/);
    expect(container.textContent).toMatch(/—/);
  });
});

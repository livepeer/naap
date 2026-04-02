import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/usePublicDashboard', () => ({
  usePublicDashboard: () => ({
    data: {
      kpi: null,
      pipelines: [],
      pipelineCatalog: [],
      orchestrators: [],
      protocol: null,
      gpuCapacity: null,
      pricing: [],
      fees: null,
      jobs: [],
      jobFeedConnected: false,
    },
    lbLoading: false,
    rtLoading: false,
    feesLoading: false,
    lbRefreshing: false,
    rtRefreshing: false,
    feesRefreshing: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/components/dashboard/overview-content', () => ({
  OverviewContent: () => <div data-testid="overview-content">Overview Content</div>,
}));

vi.mock('@/components/layout/public-top-bar', () => ({
  PublicTopBar: () => (
    <nav data-testid="public-top-bar">
      <a href="/login">Sign In</a>
      <a href="/register">Get Started</a>
    </nav>
  ),
}));

import HomePage from '../app/page';

beforeEach(() => {
  const storage: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, val: string) => { storage[key] = val; }),
      removeItem: vi.fn((key: string) => { delete storage[key]; }),
      clear: vi.fn(() => { Object.keys(storage).forEach(k => delete storage[k]); }),
      length: 0,
      key: vi.fn(() => null),
    },
    writable: true,
  });
});

describe('PublicOverviewPage', () => {
  it('renders the public top bar', () => {
    render(<HomePage />);
    expect(screen.getByTestId('public-top-bar')).toBeInTheDocument();
  });

  it('renders auth navigation links', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: /Sign In/i })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /Get Started/i })).toHaveAttribute('href', '/register');
  });

  it('renders the overview dashboard content', () => {
    render(<HomePage />);
    expect(screen.getByTestId('overview-content')).toBeInTheDocument();
  });

  it('renders a full-height layout', () => {
    const { container } = render(<HomePage />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.classList.contains('min-h-screen')).toBe(true);
  });
});

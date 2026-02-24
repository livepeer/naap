import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  MockShellProvider,
  testPluginContract,
} from '@naap/plugin-sdk/testing';

// ── Mock fetch responses matching real API shapes ────────────────────────────

const MOCK_PIPELINES = {
  pipelines: [
    {
      id: 'text-to-image',
      models: ['black-forest-labs/FLUX.1-dev', 'SG161222/RealVisXL_V4.0_Lightning'],
      regions: ['SEA'],
    },
    {
      id: 'llm',
      models: ['meta-llama/Meta-Llama-3.1-8B-Instruct'],
      regions: ['SEA'],
    },
    {
      id: 'live-video-to-video',
      models: ['noop', 'streamdiffusion-sdxl'],
      regions: ['FRA', 'MDW', 'SEA'],
    },
    { id: 'upscale', models: ['stabilityai/stable-diffusion-x4-upscaler'], regions: ['SEA'] },
  ],
};

const MOCK_AGGREGATED_STATS = {
  '0x847791cbf03be716a7fe9dc8c9affe17bd49ae5e': {
    SEA: { success_rate: 1, round_trip_score: 0.786, score: 0.925 },
  },
  '0x1234567890abcdef1234567890abcdef12345678': {
    SEA: { success_rate: 0.95, round_trip_score: 0.65, score: 0.78 },
  },
};

/**
 * Creates a mock fetch that returns gateway-envelope-wrapped responses.
 * The SDK's apiClient calls fetch(), parses JSON, then wraps it as { data: body }.
 * So fetch must return the gateway envelope: { success, data, meta }.
 */
function createMockFetch() {
  return vi.fn().mockImplementation((url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

    const envelope = (data: unknown) =>
      new Response(
        JSON.stringify({ success: true, data, meta: { connector: 'livepeer-leaderboard' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    if (urlStr.includes('/pipelines')) {
      return Promise.resolve(envelope(MOCK_PIPELINES));
    }

    if (urlStr.includes('/stats/raw')) {
      return Promise.resolve(envelope({ SEA: [] }));
    }

    if (urlStr.includes('/stats')) {
      return Promise.resolve(envelope(MOCK_AGGREGATED_STATS));
    }

    return Promise.resolve(envelope([]));
  });
}

// ── Plugin Contract Tests ────────────────────────────────────────────────────

describe('Leaderboard Plugin', () => {
  describe('Plugin Contract', () => {
    testPluginContract(() => import('../App'));

    it('exports mount function from App.tsx', async () => {
      const module = await import('../App');
      expect(typeof module.mount).toBe('function');
    });

    it('exports default plugin object', async () => {
      const module = await import('../App');
      expect(module.default).toBeDefined();
      expect(typeof module.default.mount).toBe('function');
    });
  });

  describe('UMD Mount Entry', () => {
    it('exports mount from mount.tsx', async () => {
      const module = await import('../mount');
      expect(typeof module.mount).toBe('function');
    });

    it('exports unmount from mount.tsx', async () => {
      const module = await import('../mount');
      expect(typeof module.unmount).toBe('function');
    });

    it('exports metadata with plugin name', async () => {
      const module = await import('../mount');
      expect(module.metadata).toBeDefined();
      expect(module.metadata.name).toBe('leaderboard');
    });
  });

  describe('Mount/Unmount', () => {
    it('mounts without crashing via createPlugin', async () => {
      const module = await import('../App');
      const container = document.createElement('div');
      document.body.appendChild(container);

      const { createMockShellContext } = await import('@naap/plugin-sdk/testing');
      const context = createMockShellContext();

      let cleanup: (() => void) | void;
      expect(() => {
        cleanup = module.default.mount(container, context) as (() => void) | void;
      }).not.toThrow();

      if (typeof cleanup === 'function') cleanup();
      document.body.removeChild(container);
    });
  });
});

// ── DashboardPage Tests ──────────────────────────────────────────────────────

describe('DashboardPage', () => {
  beforeEach(() => {
    globalThis.fetch = createMockFetch();
  });

  it('renders the page title', async () => {
    const { DashboardPage } = await import('../pages/DashboardPage');

    render(
      <MockShellProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </MockShellProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('AI Leaderboard')).toBeInTheDocument();
    });
  });

  it('renders KPI stat cards after data loads', async () => {
    const { DashboardPage } = await import('../pages/DashboardPage');

    render(
      <MockShellProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </MockShellProvider>,
    );

    await waitFor(
      () => {
        expect(screen.getAllByText('Pipelines').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Models')).toBeInTheDocument();
        expect(screen.getByText('Regions')).toBeInTheDocument();
        expect(screen.getByText('Top Score')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('renders pipeline cards section', async () => {
    const { DashboardPage } = await import('../pages/DashboardPage');

    render(
      <MockShellProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </MockShellProvider>,
    );

    await waitFor(
      () => {
        expect(screen.getAllByText('text-to-image').length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 3000 },
    );
  });

  it('renders top performers section', async () => {
    const { DashboardPage } = await import('../pages/DashboardPage');

    render(
      <MockShellProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </MockShellProvider>,
    );

    await waitFor(
      () => {
        expect(screen.getByText('Top Performers')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('shows error state when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { DashboardPage } = await import('../pages/DashboardPage');

    render(
      <MockShellProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </MockShellProvider>,
    );

    await waitFor(
      () => {
        expect(screen.getByText('Failed to load leaderboard')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('shows empty state when no pipelines', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { pipelines: [] }, meta: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { DashboardPage } = await import('../pages/DashboardPage');

    render(
      <MockShellProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </MockShellProvider>,
    );

    await waitFor(
      () => {
        expect(screen.getByText('No pipelines found')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});

// ── Component Unit Tests ─────────────────────────────────────────────────────

describe('ScoreBadge', () => {
  it('renders green for scores >= 0.9', async () => {
    const { ScoreBadge } = await import('../components/ScoreBadge');

    const { container } = render(<ScoreBadge score={0.95} />);
    const badge = container.querySelector('span')!;
    expect(badge.textContent).toBe('95%');
    expect(badge.className).toContain('emerald');
  });

  it('renders amber for scores >= 0.7 and < 0.9', async () => {
    const { ScoreBadge } = await import('../components/ScoreBadge');

    const { container } = render(<ScoreBadge score={0.78} />);
    const badge = container.querySelector('span')!;
    expect(badge.textContent).toBe('78%');
    expect(badge.className).toContain('amber');
  });

  it('renders red for scores < 0.7', async () => {
    const { ScoreBadge } = await import('../components/ScoreBadge');

    const { container } = render(<ScoreBadge score={0.45} />);
    const badge = container.querySelector('span')!;
    expect(badge.textContent).toBe('45%');
    expect(badge.className).toContain('red');
  });
});

describe('OrchestratorTable', () => {
  it('sorts orchestrators by score descending', async () => {
    const { OrchestratorTable } = await import('../components/OrchestratorTable');

    const data = [
      { address: '0xaaa', region: 'SEA', successRate: 0.9, roundTripScore: 0.5, score: 0.7, pipeline: 'test', model: 'test' },
      { address: '0xbbb', region: 'FRA', successRate: 1.0, roundTripScore: 0.9, score: 0.95, pipeline: 'test', model: 'test' },
      { address: '0xccc', region: 'MDW', successRate: 0.8, roundTripScore: 0.3, score: 0.5, pipeline: 'test', model: 'test' },
    ];

    render(<OrchestratorTable data={data} />);

    const rows = screen.getAllByRole('row');
    // First data row (index 1, after header) should have the highest score
    const cells = rows[1].querySelectorAll('td');
    expect(cells[1].textContent).toContain('0xbbb');
  });

  it('shows empty message when no data', async () => {
    const { OrchestratorTable } = await import('../components/OrchestratorTable');

    render(<OrchestratorTable data={[]} />);
    expect(screen.getByText('No orchestrator data available')).toBeInTheDocument();
  });
});

describe('RegionBadge', () => {
  it('renders correct region text', async () => {
    const { RegionBadge } = await import('../components/RegionBadge');

    render(<RegionBadge region="SEA" />);
    expect(screen.getByText('SEA')).toBeInTheDocument();
  });

  it('applies region-specific color', async () => {
    const { RegionBadge } = await import('../components/RegionBadge');

    const { container } = render(<RegionBadge region="FRA" />);
    const badge = container.querySelector('span')!;
    expect(badge.className).toContain('violet');
  });
});

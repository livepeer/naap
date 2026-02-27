import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MockShellProvider } from '@naap/plugin-sdk/testing';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../pages/DashboardPage';

function renderDashboard() {
  return render(
    <MockShellProvider>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </MockShellProvider>
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            summary: { totalRequests: 0, avgLatencyMs: 0, errorCount: 0, errorRate: 0 },
            byConnector: [],
            timeseries: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
  });

  it('renders dashboard heading', () => {
    renderDashboard();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders summary cards', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Requests')).toBeInTheDocument();
    });
  });
});

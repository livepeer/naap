import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MockShellProvider } from '@naap/plugin-sdk/testing';
import { MemoryRouter } from 'react-router-dom';
import { PlansPage } from '../pages/PlansPage';

function renderPlansPage() {
  return render(
    <MockShellProvider>
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>
    </MockShellProvider>
  );
}

describe('PlansPage', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('renders heading and new plan button', () => {
    renderPlansPage();
    expect(screen.getByText('Plans')).toBeInTheDocument();
    expect(screen.getByText('+ New Plan')).toBeInTheDocument();
  });

  it('shows create form when "+ New Plan" is clicked', () => {
    renderPlansPage();
    fireEvent.click(screen.getByText('+ New Plan'));
    expect(screen.getByPlaceholderText('free-tier')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Free Tier')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('disables create button when name/displayName are empty', () => {
    renderPlansPage();
    fireEvent.click(screen.getByText('+ New Plan'));
    const createBtn = screen.getByText('Create');
    expect(createBtn).toBeDisabled();
  });

  it('enables create button when name and displayName are filled', () => {
    renderPlansPage();
    fireEvent.click(screen.getByText('+ New Plan'));

    fireEvent.change(screen.getByPlaceholderText('free-tier'), { target: { value: 'basic' } });
    fireEvent.change(screen.getByPlaceholderText('Free Tier'), { target: { value: 'Basic Plan' } });

    const createBtn = screen.getByText('Create');
    expect(createBtn).not.toBeDisabled();
  });

  it('hides create form when Cancel is clicked', () => {
    renderPlansPage();
    fireEvent.click(screen.getByText('+ New Plan'));
    expect(screen.getByPlaceholderText('free-tier')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('free-tier')).not.toBeInTheDocument();
  });

  it('shows monthly quota input in create form', () => {
    renderPlansPage();
    fireEvent.click(screen.getByText('+ New Plan'));
    expect(screen.getByText('Monthly Quota (optional)')).toBeInTheDocument();
  });

  it('shows empty state when no plans exist', async () => {
    renderPlansPage();
    await waitFor(() => {
      expect(screen.getByText('No plans. Create one to set rate limits.')).toBeInTheDocument();
    });
  });

  it('renders plan rows when data is loaded', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            { id: '1', name: 'free', displayName: 'Free', rateLimit: 10, dailyQuota: 100, monthlyQuota: null, activeKeyCount: 2 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    renderPlansPage();
    await waitFor(() => {
      expect(screen.getByText('Free')).toBeInTheDocument();
    });
    expect(screen.getByText('10/min')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });
});

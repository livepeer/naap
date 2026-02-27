import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MockShellProvider } from '@naap/plugin-sdk/testing';
import { MemoryRouter } from 'react-router-dom';
import { ApiKeysPage } from '../pages/ApiKeysPage';

function renderApiKeysPage() {
  return render(
    <MockShellProvider>
      <MemoryRouter>
        <ApiKeysPage />
      </MemoryRouter>
    </MockShellProvider>
  );
}

describe('ApiKeysPage', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('renders heading and create input', () => {
    renderApiKeysPage();
    expect(screen.getByText('API Keys')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New key name...')).toBeInTheDocument();
  });

  it('disables create button when name is empty', () => {
    renderApiKeysPage();
    const createBtn = screen.getByText('Create Key');
    expect(createBtn).toBeDisabled();
  });

  it('enables create button when name is provided', () => {
    renderApiKeysPage();
    fireEvent.change(screen.getByPlaceholderText('New key name...'), { target: { value: 'test-key' } });
    const createBtn = screen.getByText('Create Key');
    expect(createBtn).not.toBeDisabled();
  });

  it('shows empty state when no keys exist', async () => {
    renderApiKeysPage();
    await waitFor(() => {
      expect(screen.getByText('No API keys yet. Create one to get started.')).toBeInTheDocument();
    });
  });

  it('renders key rows when data is loaded', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: 'key-1',
              name: 'Production Key',
              keyPrefix: 'gw_abc1234',
              status: 'active',
              lastUsedAt: null,
              createdAt: '2025-01-01T00:00:00Z',
              connector: null,
              plan: null,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    renderApiKeysPage();
    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeInTheDocument();
    });
    expect(screen.getByText('gw_abc1234...')).toBeInTheDocument();
  });
});

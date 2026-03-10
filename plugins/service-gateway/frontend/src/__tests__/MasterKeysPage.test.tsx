import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MockShellProvider } from '@naap/plugin-sdk/testing';
import { MemoryRouter } from 'react-router-dom';
import { MasterKeysPage } from '../pages/MasterKeysPage';

function renderMasterKeysPage() {
  return render(
    <MockShellProvider>
      <MemoryRouter>
        <MasterKeysPage />
      </MemoryRouter>
    </MockShellProvider>
  );
}

describe('MasterKeysPage', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('renders heading and create input', () => {
    renderMasterKeysPage();
    expect(screen.getByText('Master Keys')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New master key name...')).toBeInTheDocument();
  });

  it('disables create button when name is empty', () => {
    renderMasterKeysPage();
    const createBtn = screen.getByText('Create Master Key');
    expect(createBtn).toBeDisabled();
  });

  it('enables create button when name is provided', () => {
    renderMasterKeysPage();
    fireEvent.change(screen.getByPlaceholderText('New master key name...'), { target: { value: 'test-key' } });
    const createBtn = screen.getByText('Create Master Key');
    expect(createBtn).not.toBeDisabled();
  });

  it('shows empty state when no keys exist', async () => {
    renderMasterKeysPage();
    await waitFor(() => {
      expect(screen.getByText('No master keys found.')).toBeInTheDocument();
    });
  });

  it('displays key list from API response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: 'mk-1',
              name: 'Agent Master Key',
              keyPrefix: 'gwm_abc12345',
              status: 'active',
              scopes: ['proxy', 'discovery'],
              allowedIPs: [],
              expiresAt: null,
              lastUsedAt: null,
              createdAt: '2026-01-01T00:00:00Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    renderMasterKeysPage();
    await waitFor(() => {
      expect(screen.getByText('Agent Master Key')).toBeInTheDocument();
    });
    expect(screen.getByText('gwm_abc12345...')).toBeInTheDocument();
    expect(screen.getByText('proxy, discovery')).toBeInTheDocument();
  });
});

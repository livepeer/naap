import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ProviderSettings } from '../../pages/ProviderSettings';
import type { Provider } from '../../hooks/useProviders';

vi.mock('lucide-react', () => ({
  Settings: (props: any) => <svg data-testid="settings-icon" {...props} />,
  Shield: (props: any) => <svg data-testid="shield-icon" {...props} />,
  Check: (props: any) => <svg data-testid="check-icon" {...props} />,
  X: (props: any) => <svg data-testid="x-icon" {...props} />,
}));

const mockProviders: Provider[] = [
  {
    slug: 'replicate',
    displayName: 'Replicate',
    description: 'Serverless GPU inference',
    icon: '🔁',
    mode: 'serverless',
    authMethod: 'api-key',
    secretNames: ['api-key'],
  },
  {
    slug: 'ssh-bridge',
    displayName: 'SSH Bridge',
    description: 'Self-hosted GPU via SSH',
    icon: '🖥️',
    mode: 'ssh-bridge',
    authMethod: 'ssh-key',
    secretNames: [],
  },
  {
    slug: 'modal',
    displayName: 'Modal',
    description: 'Cloud GPU provider',
    icon: '⚡',
    mode: 'serverless',
    authMethod: 'token',
    secretNames: ['token'],
  },
];

vi.mock('../../hooks/useProviders', () => ({
  useProviders: vi.fn(() => ({
    providers: mockProviders,
    loading: false,
  })),
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ProviderSettings', () => {
  it('renders the page heading', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    expect(screen.getByText('Provider Settings')).toBeInTheDocument();
  });

  it('renders description text', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    expect(screen.getByText(/Configure authentication credentials/)).toBeInTheDocument();
  });

  it('renders all provider buttons', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    expect(screen.getByText('Replicate')).toBeInTheDocument();
    expect(screen.getByText('SSH Bridge')).toBeInTheDocument();
    expect(screen.getByText('Modal')).toBeInTheDocument();
  });

  it('shows "Select a provider" when none is selected', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    expect(screen.getByText('Select a provider to configure')).toBeInTheDocument();
  });

  it('shows credential form when a serverless provider is selected', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Replicate'));
    });

    expect(screen.getByText('Replicate Credentials')).toBeInTheDocument();
    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter api-key for Replicate')).toBeInTheDocument();
    expect(screen.getByText('Save Credentials')).toBeInTheDocument();
  });

  it('shows SSH message for ssh-bridge provider', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('SSH Bridge'));
    });

    expect(screen.getByText('SSH Bridge Credentials')).toBeInTheDocument();
    expect(screen.getByText(/SSH credentials are configured per-deployment/)).toBeInTheDocument();
    expect(screen.queryByText('Save Credentials')).not.toBeInTheDocument();
  });

  it('shows token label for token-based provider', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Modal'));
    });

    expect(screen.getByText('Bearer Token')).toBeInTheDocument();
  });

  it('disables save button when api key is empty', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Replicate'));
    });

    const saveBtn = screen.getByText('Save Credentials');
    expect(saveBtn).toBeDisabled();
  });

  it('saves credentials and shows success message', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Replicate'));
    });

    const input = screen.getByPlaceholderText('Enter api-key for Replicate');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'sk-test-key-123' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Credentials'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(screen.getByText('Credentials saved for replicate')).toBeInTheDocument();
  });

  it('clears api key field after successful save', async () => {
    await act(async () => {
      render(<ProviderSettings />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Replicate'));
    });

    const input = screen.getByPlaceholderText('Enter api-key for Replicate') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'sk-test-key-123' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Credentials'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(input.value).toBe('');
  });
});

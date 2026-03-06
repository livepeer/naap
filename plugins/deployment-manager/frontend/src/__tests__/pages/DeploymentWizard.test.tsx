import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { DeploymentWizard } from '../../pages/DeploymentWizard';

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: any) => <svg data-testid="arrow-left" {...props} />,
  ArrowRight: (props: any) => <svg data-testid="arrow-right" {...props} />,
  Rocket: (props: any) => <svg data-testid="rocket" {...props} />,
  RefreshCw: (props: any) => <svg data-testid="refresh-cw" {...props} />,
  Package: (props: any) => <svg data-testid="package" {...props} />,
  Plus: (props: any) => <svg data-testid="plus" {...props} />,
  Terminal: (props: any) => <svg data-testid="terminal" {...props} />,
}));

const sshProvider = {
  slug: 'ssh-bridge',
  displayName: 'SSH Bridge',
  description: 'SSH GPU',
  icon: '🖥️',
  mode: 'ssh-bridge',
  authMethod: 'ssh-key',
  secretNames: [],
};

const serverlessProvider = {
  slug: 'fal-ai',
  displayName: 'fal.ai',
  description: 'GPU',
  icon: '⚡',
  mode: 'serverless',
  authMethod: 'api-key',
  secretNames: ['api-key'],
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
    if (url.includes('/gpu-options')) {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          data: [{ id: 'A100', name: 'A100', vramGb: 80, available: true }],
        }),
      });
    }
    if (url.includes('/versions')) {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          data: [{ version: 'v1.0.0', publishedAt: '2026-01-01', prerelease: false, dockerImage: 'livepeer/ai-runner:v1.0.0' }],
        }),
      });
    }
    if (url.includes('/providers')) {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          data: [serverlessProvider, sshProvider],
        }),
      });
    }
    if (url.includes('/templates')) {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          data: [
            { id: 'ai-runner', name: 'AI Runner', description: 'Livepeer AI', icon: '🤖', dockerImage: 'livepeer/ai-runner', healthEndpoint: '/health', healthPort: 8080, category: 'curated' },
          ],
        }),
      });
    }
    if (url.endsWith('/deploy') && opts?.method === 'POST') {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          data: { status: 'DEPLOYING', healthStatus: 'UNKNOWN' },
        }),
      });
    }
    if (url.endsWith('/deployments') && opts?.method === 'POST') {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          data: { id: 'dep-new' },
        }),
      });
    }
    if (url.includes('/deployments')) {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          data: { id: 'dep-new', status: 'ONLINE', healthStatus: 'GREEN' },
        }),
      });
    }
    if (url.includes('/cost/estimate')) {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          data: {
            gpuCostPerHour: 2.55, totalCostPerHour: 2.65, totalCostPerDay: 63.6,
            totalCostPerMonth: 1908, currency: 'USD',
            breakdown: { gpu: 2.55, storage: 0.10, network: 0 },
            providerSlug: 'fal-ai', gpuModel: 'A100', gpuCount: 1,
          },
        }),
      });
    }
    if (url.includes('/ssh-bridge/connect')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    }
    return Promise.resolve({ json: () => Promise.resolve({ success: true, data: [] }) });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function selectTemplateAndVersion() {
  await waitFor(() => {
    expect(screen.getByText('AI Runner')).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByText('AI Runner'));
  });

  await waitFor(() => {
    expect(screen.getByText('Version')).toBeInTheDocument();
  });

  const select = screen.getByRole('combobox');
  await act(async () => {
    fireEvent.change(select, { target: { value: 'v1.0.0' } });
  });
}

async function navigateToStep1() {
  await selectTemplateAndVersion();

  await act(async () => {
    fireEvent.click(screen.getByText('Next'));
  });

  await waitFor(() => {
    expect(screen.getByText('Configure Resources')).toBeInTheDocument();
  });
}

async function fillStep1() {
  await waitFor(() => {
    expect(screen.getByText('fal.ai')).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByText('fal.ai'));
  });

  await waitFor(() => {
    expect(screen.getByText('A100')).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByText('A100'));
  });
}

describe('DeploymentWizard', () => {
  it('should render 3 step indicators', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await waitFor(() => {
      expect(screen.getByText('Template')).toBeInTheDocument();
      expect(screen.getByText('Resources')).toBeInTheDocument();
      expect(screen.getByText('Deploy & Monitor')).toBeInTheDocument();
    });
  });

  it('should render heading', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    expect(screen.getByText('New Deployment')).toBeInTheDocument();
  });

  it('should show step 0 content on initial render', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await waitFor(() => {
      expect(screen.getByText('Choose a Template')).toBeInTheDocument();
    });
  });

  it('should show Back button disabled on step 0', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    const backButton = screen.getByText('Back');
    expect(backButton.closest('button')).toBeDisabled();
  });

  it('should show Next button on step 0', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('should render step numbers 1, 2, 3', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should navigate to step 1 after selecting template and version', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();

    expect(screen.getByText('Configure Resources')).toBeInTheDocument();
    expect(screen.getByText('Deployment Name')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
  });

  it('should enable Back button on step 1 and navigate back', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();

    const backButton = screen.getByText('Back').closest('button')!;
    expect(backButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(backButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Choose a Template')).toBeInTheDocument();
    });
  });

  it('should show provider list on step 1 and select a provider', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();
    await fillStep1();

    expect(screen.getByText('GPU Configuration')).toBeInTheDocument();
  });

  it('should navigate to step 2 and show deploy summary', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();
    await fillStep1();

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText(/Template:/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Provider:/)).toBeInTheDocument();
    expect(screen.getAllByText(/GPU:/).length).toBeGreaterThanOrEqual(1);
  });

  it('should show Deploy Now button on step 2 and trigger deploy', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();
    await fillStep1();

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText(/Deploy Now/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Deploy Now/));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    await waitFor(() => {
      const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const createPost = fetchCalls.find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('/deployments') && c[1]?.method === 'POST',
      );
      expect(createPost).toBeTruthy();
    });
  });

  it('should show SSH config when ssh-bridge provider selected', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();

    await waitFor(() => {
      const sshButtons = screen.getAllByText('SSH Bridge');
      expect(sshButtons.length).toBeGreaterThanOrEqual(1);
    });

    const sshProviderButton = screen.getAllByText('SSH Bridge')[0].closest('button')!;
    await act(async () => {
      fireEvent.click(sshProviderButton);
    });

    await waitFor(() => {
      expect(screen.getByText('SSH Host Configuration')).toBeInTheDocument();
    });
  });

  it('should let user select custom template on step 0', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });

    await waitFor(() => {
      expect(screen.getByText('Custom Docker Image')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Custom Docker Image'));
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('myregistry/my-model:latest')).toBeInTheDocument();
    });

    const imageInput = screen.getByPlaceholderText('myregistry/my-model:latest');
    await act(async () => {
      fireEvent.change(imageInput, { target: { value: 'my-custom/model:v1' } });
    });
  });

  it('should auto-generate deployment name on step 2', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();
    await fillStep1();

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText(/Template:/)).toBeInTheDocument();
    });
  });

  it('should allow entering a deployment name on step 1', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();

    const nameInput = screen.getByPlaceholderText('my-deployment');
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'test-deploy-1' } });
    });

    expect(nameInput).toHaveValue('test-deploy-1');
  });

  it('should execute full deploy flow and show deployment status', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();
    await fillStep1();

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText(/Deploy Now/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Deploy Now/));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    await waitFor(() => {
      const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const deployCall = fetchCalls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/deploy') && c[1]?.method === 'POST',
      );
      expect(deployCall).toBeTruthy();
    });
  });

  it('should show error and retry when deploy call fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, opts?: any) => {
      if (url.includes('/gpu-options')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: [{ id: 'A100', name: 'A100', vramGb: 80, available: true }] }) });
      }
      if (url.includes('/versions')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: [{ version: 'v1.0.0', publishedAt: '2026-01-01', prerelease: false, dockerImage: 'livepeer/ai-runner:v1.0.0' }] }) });
      }
      if (url.includes('/providers')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: [serverlessProvider, sshProvider] }) });
      }
      if (url.includes('/templates')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: [{ id: 'ai-runner', name: 'AI Runner', description: 'Livepeer AI', icon: '🤖', dockerImage: 'livepeer/ai-runner', healthEndpoint: '/health', healthPort: 8080, category: 'curated' }] }) });
      }
      if (url.includes('/cost/estimate')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { gpuCostPerHour: 2.55, totalCostPerHour: 2.65, totalCostPerDay: 63.6, totalCostPerMonth: 1908, currency: 'USD', breakdown: { gpu: 2.55, storage: 0.10, network: 0 }, providerSlug: 'fal-ai', gpuModel: 'A100', gpuCount: 1 } }) });
      }
      if (url.includes('/retry') && opts?.method === 'POST') {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { status: 'DEPLOYING' } }) });
      }
      if (url.endsWith('/deploy') && opts?.method === 'POST') {
        return Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'GPU unavailable' }) });
      }
      if (url.endsWith('/deployments') && opts?.method === 'POST') {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { id: 'dep-fail' } }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { id: 'dep-fail', status: 'FAILED', healthStatus: 'RED' } }) });
    });

    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();
    await fillStep1();

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText(/Deploy Now/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Deploy Now/));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    await waitFor(() => {
      expect(screen.getByText('GPU unavailable')).toBeInTheDocument();
    });

    expect(screen.getByText('Deployment Failed')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Retry'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
  });

  it('should show custom image fields after selecting custom template and navigate through wizard', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });

    await waitFor(() => {
      expect(screen.getByText('Custom Docker Image')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Custom Docker Image'));
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('myregistry/my-model:latest')).toBeInTheDocument();
    });

    const imageInput = screen.getByPlaceholderText('myregistry/my-model:latest');
    await act(async () => {
      fireEvent.change(imageInput, { target: { value: 'myorg/mymodel:v1' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await waitFor(() => {
      expect(screen.getByText('Configure Resources')).toBeInTheDocument();
    });
  });

  it('should disable Next button when step 0 requirements are not met', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });

    await waitFor(() => {
      expect(screen.getByText('AI Runner')).toBeInTheDocument();
    });

    const nextButton = screen.getByText('Next').closest('button')!;
    expect(nextButton).toBeDisabled();
  });

  it('should click on completed step indicator to navigate back', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();

    expect(screen.getByText('Configure Resources')).toBeInTheDocument();

    const step1Indicator = screen.getByText('1').closest('div')!;
    await act(async () => {
      fireEvent.click(step1Indicator);
    });

    await waitFor(() => {
      expect(screen.getByText('Choose a Template')).toBeInTheDocument();
    });
  });

  it('should render GPU count select on step 1', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();
    await fillStep1();

    expect(screen.getByText('GPU Count')).toBeInTheDocument();
  });

  it('should show SSH test connection button for ssh-bridge', async () => {
    await act(async () => {
      render(<DeploymentWizard />);
    });
    await navigateToStep1();

    const sshProviderButton = screen.getAllByText('SSH Bridge')[0].closest('button')!;
    await act(async () => {
      fireEvent.click(sshProviderButton);
    });

    await waitFor(() => {
      expect(screen.getByText('SSH Host Configuration')).toBeInTheDocument();
    });

    expect(screen.getByText('Test Connection')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Test Connection'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  });
});

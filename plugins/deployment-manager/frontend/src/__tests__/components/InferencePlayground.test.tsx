import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InferencePlayground } from '../../components/InferencePlayground';

const mockPipelineStatus = {
  capabilityName: 'flux-dev',
  topology: 'split-cpu-serverless',
  adapterHealthy: true,
  deploymentStatus: 'ONLINE',
  healthStatus: 'GREEN',
  endpointUrl: 'http://10.0.0.1:9090',
  orchestratorSecret: '***',
};

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('InferencePlayground', () => {
  it('fetches and displays pipeline status', async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/pipeline-status')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: mockPipelineStatus }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
    });

    render(<InferencePlayground deploymentId="dep-1" endpointUrl="http://10.0.0.1:9090" />);

    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toBeDefined();
    });
    expect(screen.getByText('flux-dev')).toBeDefined();
    expect(screen.getByText('split-cpu-serverless')).toBeDefined();
    expect(screen.getByText('Healthy')).toBeDefined();
  });

  it('renders run inference button', async () => {
    (global.fetch as any).mockResolvedValue({ json: () => Promise.resolve({ success: true, data: mockPipelineStatus }) });

    render(<InferencePlayground deploymentId="dep-1" endpointUrl="http://10.0.0.1:9090" />);

    await waitFor(() => {
      expect(screen.getByTestId('run-inference')).toBeDefined();
    });
  });

  it('disables run button when no endpoint URL', async () => {
    (global.fetch as any).mockResolvedValue({ json: () => Promise.resolve({ success: true, data: mockPipelineStatus }) });

    render(<InferencePlayground deploymentId="dep-1" />);

    await waitFor(() => {
      const btn = screen.getByTestId('run-inference') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it('renders inference request textarea', async () => {
    (global.fetch as any).mockResolvedValue({ json: () => Promise.resolve({ success: true, data: mockPipelineStatus }) });

    render(<InferencePlayground deploymentId="dep-1" endpointUrl="http://10.0.0.1:9090" />);

    await waitFor(() => {
      expect(screen.getByTestId('inference-request-body')).toBeDefined();
    });
  });

  it('shows error for invalid JSON', async () => {
    (global.fetch as any).mockResolvedValue({ json: () => Promise.resolve({ success: true, data: mockPipelineStatus }) });

    render(<InferencePlayground deploymentId="dep-1" endpointUrl="http://10.0.0.1:9090" />);

    await waitFor(() => screen.getByTestId('inference-request-body'));

    fireEvent.change(screen.getByTestId('inference-request-body'), { target: { value: 'not json' } });
    fireEvent.click(screen.getByTestId('run-inference'));

    await waitFor(() => {
      expect(screen.getByText('Invalid JSON in request body')).toBeDefined();
    });
  });

  it('shows response after successful invoke', async () => {
    let callCount = 0;
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/pipeline-status')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: mockPipelineStatus }) });
      }
      if (url.includes('/invoke')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            success: true,
            data: { status: 200, statusText: 'OK', responseTimeMs: 150, body: { result: 'image.png' } },
          }),
        });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
    });

    render(<InferencePlayground deploymentId="dep-1" endpointUrl="http://10.0.0.1:9090" />);

    await waitFor(() => screen.getByTestId('run-inference'));
    fireEvent.click(screen.getByTestId('run-inference'));

    await waitFor(() => {
      expect(screen.getByTestId('inference-response')).toBeDefined();
    });
    expect(screen.getByText('200 OK')).toBeDefined();
  });

  it('shows unhealthy adapter status', async () => {
    const unhealthyStatus = { ...mockPipelineStatus, adapterHealthy: false };
    (global.fetch as any).mockResolvedValue({ json: () => Promise.resolve({ success: true, data: unhealthyStatus }) });

    render(<InferencePlayground deploymentId="dep-1" endpointUrl="http://10.0.0.1:9090" />);

    await waitFor(() => {
      expect(screen.getByText('Unhealthy')).toBeDefined();
    });
  });
});

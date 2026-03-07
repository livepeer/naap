/**
 * BDD-style E2E tests for the Livepeer Inference Wizard flow.
 *
 * These tests exercise:
 *   - LivepeerConfigForm: topology selection, provider config, field visibility
 *   - InferencePlayground: pipeline status display, inference requests, error handling
 *
 * Each `describe` block maps to a BDD Scenario with Given/When/Then steps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LivepeerConfigForm, type LivepeerConfig } from '../../components/LivepeerConfigForm';
import { InferencePlayground } from '../../components/InferencePlayground';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const defaultConfig: LivepeerConfig = {
  topology: 'split-cpu-serverless',
  serverlessProvider: '',
  serverlessModelId: '',
  serverlessApiKey: '',
  serverlessEndpointUrl: '',
  modelImage: '',
  capacity: 1,
  pricePerUnit: 1200,
  publicAddress: '',
  capabilityName: '',
};

const mockPipelineStatus = {
  capabilityName: 'flux-dev',
  topology: 'split-cpu-serverless',
  adapterHealthy: true,
  deploymentStatus: 'ONLINE',
  healthStatus: 'GREEN',
  endpointUrl: 'http://10.0.0.1:9090',
  orchestratorSecret: '***',
};

// ---------------------------------------------------------------------------
// Scenario 1: Topology 3 (split-cpu-serverless) configuration flow
// ---------------------------------------------------------------------------
describe('Scenario 1: split-cpu-serverless configuration flow', () => {
  it(`Given the LivepeerConfigForm with default config
      When the user selects "split-cpu-serverless" topology
      And selects "fal-ai" as serverless provider
      And enters model ID "fal-ai/flux/dev"
      And enters API key "test-key"
      Then onChange is called with correct field values
      And the form shows the model ID and API key fields`, () => {
    const onChange = vi.fn();

    // Given: render with default config (topology already split-cpu-serverless)
    const { rerender } = render(
      <LivepeerConfigForm config={defaultConfig} onChange={onChange} />,
    );

    // When: user clicks split-cpu-serverless topology button
    fireEvent.click(screen.getByTestId('topology-split-cpu-serverless'));
    expect(onChange).toHaveBeenCalledWith('topology', 'split-cpu-serverless');

    // When: user selects "fal-ai" as serverless provider
    fireEvent.change(screen.getByTestId('serverless-provider'), {
      target: { value: 'fal-ai' },
    });
    expect(onChange).toHaveBeenCalledWith('serverlessProvider', 'fal-ai');

    // Simulate parent state update so the model/key fields appear
    const configWithProvider: LivepeerConfig = {
      ...defaultConfig,
      serverlessProvider: 'fal-ai',
    };
    rerender(<LivepeerConfigForm config={configWithProvider} onChange={onChange} />);

    // When: user enters model ID
    const modelInput = screen.getByTestId('serverless-model-id');
    fireEvent.change(modelInput, { target: { value: 'fal-ai/flux/dev' } });
    expect(onChange).toHaveBeenCalledWith('serverlessModelId', 'fal-ai/flux/dev');

    // When: user enters API key
    const apiKeyInput = screen.getByTestId('serverless-api-key');
    fireEvent.change(apiKeyInput, { target: { value: 'test-key' } });
    expect(onChange).toHaveBeenCalledWith('serverlessApiKey', 'test-key');

    // Then: model ID and API key fields are visible
    expect(modelInput).toBeDefined();
    expect(apiKeyInput).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Topology 1 (all-in-one) shows model image field
// ---------------------------------------------------------------------------
describe('Scenario 2: all-in-one topology shows model image field', () => {
  it(`Given the LivepeerConfigForm with topology "all-in-one"
      When the form renders
      Then it shows the model image input
      And it does NOT show serverless provider dropdown`, () => {
    const config: LivepeerConfig = { ...defaultConfig, topology: 'all-in-one' };

    // Given & When
    render(<LivepeerConfigForm config={config} onChange={vi.fn()} />);

    // Then: model image input is present
    expect(screen.getByTestId('model-image')).toBeDefined();

    // Then: serverless provider dropdown is NOT present
    expect(screen.queryByTestId('serverless-provider')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Custom provider shows endpoint URL
// ---------------------------------------------------------------------------
describe('Scenario 3: custom provider shows endpoint URL field', () => {
  it(`Given the LivepeerConfigForm with topology "split-cpu-serverless"
      And serverless provider is "custom"
      When the form renders
      Then it shows the endpoint URL field
      And it does NOT show the API key field`, () => {
    const config: LivepeerConfig = {
      ...defaultConfig,
      topology: 'split-cpu-serverless',
      serverlessProvider: 'custom',
    };

    // Given & When
    render(<LivepeerConfigForm config={config} onChange={vi.fn()} />);

    // Then: endpoint URL field is shown
    expect(screen.getByTestId('serverless-endpoint-url')).toBeDefined();

    // Then: API key field is NOT shown
    expect(screen.queryByTestId('serverless-api-key')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: InferencePlayground displays pipeline status
// ---------------------------------------------------------------------------
describe('Scenario 4: InferencePlayground displays pipeline status', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it(`Given a deployed livepeer-inference deployment
      When the InferencePlayground loads
      Then it fetches and displays the pipeline status
      And shows capability name, topology, and health`, async () => {
    // Given: mock the pipeline-status endpoint
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/pipeline-status')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: mockPipelineStatus }),
        });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
    });

    // When: render the playground
    render(
      <InferencePlayground deploymentId="dep-lp-1" endpointUrl="http://10.0.0.1:9090" />,
    );

    // Then: pipeline status card appears with the expected data
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-status')).toBeDefined();
    });

    expect(screen.getByText('flux-dev')).toBeDefined();
    expect(screen.getByText('split-cpu-serverless')).toBeDefined();
    expect(screen.getByText('Healthy')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: InferencePlayground handles inference request
// ---------------------------------------------------------------------------
describe('Scenario 5: InferencePlayground handles inference request', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it(`Given a deployed livepeer-inference deployment with endpoint
      When the user clicks "Run Inference"
      Then the request is sent to the invoke endpoint
      And the response is displayed`, async () => {
    // Given: mock both pipeline-status and invoke endpoints
    (global.fetch as any).mockImplementation((url: string, opts?: any) => {
      if (url.includes('/pipeline-status')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: mockPipelineStatus }),
        });
      }
      if (url.includes('/invoke')) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                status: 200,
                statusText: 'OK',
                responseTimeMs: 42,
                body: { result: 'generated-image.png' },
              },
            }),
        });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
    });

    render(
      <InferencePlayground deploymentId="dep-lp-2" endpointUrl="http://10.0.0.1:9090" />,
    );

    // Wait for pipeline status to load so the button becomes interactive
    await waitFor(() => {
      expect(screen.getByTestId('run-inference')).toBeDefined();
    });

    // When: user clicks Run Inference
    fireEvent.click(screen.getByTestId('run-inference'));

    // Then: invoke endpoint was called
    await waitFor(() => {
      const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const invokeCall = fetchCalls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/invoke'),
      );
      expect(invokeCall).toBeTruthy();
    });

    // Then: response card is displayed
    await waitFor(() => {
      expect(screen.getByTestId('inference-response')).toBeDefined();
    });
    expect(screen.getByText('200 OK')).toBeDefined();
    expect(screen.getByText(/42ms/)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: InferencePlayground shows error for invalid JSON
// ---------------------------------------------------------------------------
describe('Scenario 6: InferencePlayground shows error for invalid JSON', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it(`Given the InferencePlayground with an endpoint
      When the user enters invalid JSON and clicks Run
      Then an error message "Invalid JSON in request body" is shown`, async () => {
    // Given: mock pipeline-status
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/pipeline-status')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: mockPipelineStatus }),
        });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
    });

    render(
      <InferencePlayground deploymentId="dep-lp-3" endpointUrl="http://10.0.0.1:9090" />,
    );

    // Wait for the textarea to appear
    await waitFor(() => {
      expect(screen.getByTestId('inference-request-body')).toBeDefined();
    });

    // When: user types invalid JSON
    fireEvent.change(screen.getByTestId('inference-request-body'), {
      target: { value: '{ this is not valid json }' },
    });

    // When: user clicks Run Inference
    fireEvent.click(screen.getByTestId('run-inference'));

    // Then: error message is displayed
    await waitFor(() => {
      expect(screen.getByText('Invalid JSON in request body')).toBeDefined();
    });
  });
});

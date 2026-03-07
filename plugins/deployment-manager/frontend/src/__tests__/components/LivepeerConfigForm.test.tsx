import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LivepeerConfigForm, type LivepeerConfig } from '../../components/LivepeerConfigForm';

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

describe('LivepeerConfigForm', () => {
  it('renders topology options', () => {
    render(<LivepeerConfigForm config={defaultConfig} onChange={vi.fn()} />);
    expect(screen.getByTestId('topology-split-cpu-serverless')).toBeDefined();
    expect(screen.getByTestId('topology-all-in-one')).toBeDefined();
    expect(screen.getByTestId('topology-all-on-provider')).toBeDefined();
  });

  it('calls onChange when topology is selected', () => {
    const onChange = vi.fn();
    render(<LivepeerConfigForm config={defaultConfig} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('topology-all-in-one'));
    expect(onChange).toHaveBeenCalledWith('topology', 'all-in-one');
  });

  it('shows serverless provider dropdown for split-cpu-serverless topology', () => {
    render(<LivepeerConfigForm config={defaultConfig} onChange={vi.fn()} />);
    expect(screen.getByTestId('serverless-provider')).toBeDefined();
  });

  it('shows model and API key fields when provider is selected', () => {
    const config = { ...defaultConfig, serverlessProvider: 'fal-ai' };
    render(<LivepeerConfigForm config={config} onChange={vi.fn()} />);
    expect(screen.getByTestId('serverless-model-id')).toBeDefined();
    expect(screen.getByTestId('serverless-api-key')).toBeDefined();
  });

  it('shows endpoint URL field for custom provider', () => {
    const config = { ...defaultConfig, serverlessProvider: 'custom' };
    render(<LivepeerConfigForm config={config} onChange={vi.fn()} />);
    expect(screen.getByTestId('serverless-endpoint-url')).toBeDefined();
  });

  it('shows model image field for all-in-one topology', () => {
    const config = { ...defaultConfig, topology: 'all-in-one' as const };
    render(<LivepeerConfigForm config={config} onChange={vi.fn()} />);
    expect(screen.getByTestId('model-image')).toBeDefined();
  });

  it('does not show serverless fields for all-in-one topology', () => {
    const config = { ...defaultConfig, topology: 'all-in-one' as const };
    render(<LivepeerConfigForm config={config} onChange={vi.fn()} />);
    expect(screen.queryByTestId('serverless-provider')).toBeNull();
  });

  it('calls onChange when serverless provider changes', () => {
    const onChange = vi.fn();
    render(<LivepeerConfigForm config={defaultConfig} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('serverless-provider'), { target: { value: 'fal-ai' } });
    expect(onChange).toHaveBeenCalledWith('serverlessProvider', 'fal-ai');
  });

  it('calls onChange when model ID changes', () => {
    const onChange = vi.fn();
    const config = { ...defaultConfig, serverlessProvider: 'fal-ai' };
    render(<LivepeerConfigForm config={config} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('serverless-model-id'), { target: { value: 'fal-ai/flux/dev' } });
    expect(onChange).toHaveBeenCalledWith('serverlessModelId', 'fal-ai/flux/dev');
  });
});

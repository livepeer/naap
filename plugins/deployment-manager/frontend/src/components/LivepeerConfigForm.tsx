import React from 'react';

export type LivepeerTopology = 'all-in-one' | 'all-on-provider' | 'split-cpu-serverless';

export interface LivepeerConfig {
  topology: LivepeerTopology;
  serverlessProvider: string;
  serverlessModelId: string;
  serverlessApiKey: string;
  serverlessEndpointUrl: string;
  modelImage: string;
  capacity: number;
  pricePerUnit: number;
  publicAddress: string;
  capabilityName: string;
}

interface LivepeerConfigFormProps {
  config: LivepeerConfig;
  onChange: (field: keyof LivepeerConfig, value: string | number) => void;
}

const TOPOLOGIES: { id: LivepeerTopology; name: string; description: string }[] = [
  {
    id: 'split-cpu-serverless',
    name: 'CPU + Remote Inference',
    description: 'Run orchestrator on CPU, proxy to an existing AI service (fal.ai, Replicate, etc.)',
  },
  {
    id: 'all-in-one',
    name: 'All-in-One (Self-Hosted GPU)',
    description: 'Run orchestrator, adapter, and model on a single GPU machine.',
  },
  {
    id: 'all-on-provider',
    name: 'All on Cloud Provider',
    description: 'Deploy everything on a cloud GPU provider (RunPod, etc.).',
  },
];

const SERVERLESS_PROVIDERS = [
  { id: 'fal-ai', name: 'fal.ai' },
  { id: 'replicate', name: 'Replicate' },
  { id: 'runpod', name: 'RunPod Serverless' },
  { id: 'custom', name: 'Custom Endpoint' },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--dm-border-input)',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  color: 'var(--dm-text-primary)',
  backgroundColor: 'var(--dm-bg-input)',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 500,
  display: 'block',
  marginBottom: '0.25rem',
  color: 'var(--dm-text-secondary)',
};

export const LivepeerConfigForm: React.FC<LivepeerConfigFormProps> = ({ config, onChange }) => {
  const isServerless = config.topology === 'split-cpu-serverless';
  const needsModel = config.topology === 'all-in-one' || config.topology === 'all-on-provider';
  const isCustomProvider = config.serverlessProvider === 'custom';

  return (
    <div>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--dm-text-primary)' }}>
        Livepeer Inference Configuration
      </h3>
      <p style={{ color: 'var(--dm-text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Configure how your AI inference service connects to the Livepeer network.
      </p>

      {/* Topology selection */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={labelStyle}>Deployment Topology *</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {TOPOLOGIES.map((t) => (
            <button
              key={t.id}
              data-testid={`topology-${t.id}`}
              onClick={() => onChange('topology', t.id)}
              style={{
                padding: '0.75rem 1rem',
                border: config.topology === t.id ? '2px solid var(--dm-accent-blue)' : '1px solid var(--dm-border)',
                borderRadius: '0.5rem',
                background: config.topology === t.id ? 'var(--dm-bg-selected)' : 'var(--dm-bg-primary)',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--dm-text-primary)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--dm-text-secondary)', marginTop: '0.2rem' }}>{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Serverless provider config */}
      {isServerless && (
        <div style={{ padding: '1rem', background: 'var(--dm-bg-secondary)', borderRadius: '0.5rem', marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Inference Provider *</label>
            <select
              value={config.serverlessProvider}
              onChange={(e) => onChange('serverlessProvider', e.target.value)}
              data-testid="serverless-provider"
              style={{ ...inputStyle, maxWidth: '300px' }}
            >
              <option value="">Select provider...</option>
              {SERVERLESS_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {config.serverlessProvider && !isCustomProvider && (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Model ID *</label>
                <input
                  type="text"
                  value={config.serverlessModelId}
                  onChange={(e) => onChange('serverlessModelId', e.target.value)}
                  placeholder="e.g. fal-ai/flux/dev"
                  data-testid="serverless-model-id"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>API Key *</label>
                <input
                  type="password"
                  value={config.serverlessApiKey}
                  onChange={(e) => onChange('serverlessApiKey', e.target.value)}
                  placeholder="Your provider API key"
                  data-testid="serverless-api-key"
                  style={inputStyle}
                />
              </div>
            </>
          )}

          {isCustomProvider && (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Endpoint URL *</label>
                <input
                  type="text"
                  value={config.serverlessEndpointUrl}
                  onChange={(e) => onChange('serverlessEndpointUrl', e.target.value)}
                  placeholder="https://your-service.example.com/api"
                  data-testid="serverless-endpoint-url"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Model ID (optional)</label>
                <input
                  type="text"
                  value={config.serverlessModelId}
                  onChange={(e) => onChange('serverlessModelId', e.target.value)}
                  placeholder="Model identifier"
                  style={inputStyle}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Model image for self-hosted */}
      {needsModel && (
        <div style={{ padding: '1rem', background: 'var(--dm-bg-secondary)', borderRadius: '0.5rem', marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Model Docker Image *</label>
            <input
              type="text"
              value={config.modelImage}
              onChange={(e) => onChange('modelImage', e.target.value)}
              placeholder="ghcr.io/huggingface/text-generation-inference:latest"
              data-testid="model-image"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Model ID</label>
            <input
              type="text"
              value={config.serverlessModelId}
              onChange={(e) => onChange('serverlessModelId', e.target.value)}
              placeholder="meta-llama/Llama-3.1-70B-Instruct"
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {/* Advanced settings */}
      <div style={{ marginBottom: '1.5rem' }}>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500, color: 'var(--dm-text-secondary)', marginBottom: '0.75rem' }}>
            Advanced Settings
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '0.5rem 0' }}>
            <div>
              <label style={labelStyle}>Capacity</label>
              <input
                type="number"
                min={1}
                max={100}
                value={config.capacity}
                onChange={(e) => onChange('capacity', parseInt(e.target.value, 10) || 1)}
                data-testid="capacity"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Price Per Unit</label>
              <input
                type="number"
                min={0}
                value={config.pricePerUnit}
                onChange={(e) => onChange('pricePerUnit', parseInt(e.target.value, 10) || 0)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Public Address</label>
              <input
                type="text"
                value={config.publicAddress}
                onChange={(e) => onChange('publicAddress', e.target.value)}
                placeholder="203.0.113.1:7935"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Capability Name (auto-derived)</label>
              <input
                type="text"
                value={config.capabilityName}
                onChange={(e) => onChange('capabilityName', e.target.value)}
                placeholder="Leave blank to auto-derive from model"
                data-testid="capability-name"
                style={inputStyle}
              />
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};

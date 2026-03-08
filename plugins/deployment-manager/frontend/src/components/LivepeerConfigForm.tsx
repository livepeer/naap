import React from 'react';
import { ModelPresetPicker, getPresetsForProvider, getSelfHostedPresets, type ModelPreset } from './ModelPresets';

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

export const LivepeerConfigForm: React.FC<LivepeerConfigFormProps> = ({ config, onChange }) => {
  const isServerless = config.topology === 'split-cpu-serverless';
  const needsModel = config.topology === 'all-in-one' || config.topology === 'all-on-provider';
  const isCustomProvider = config.serverlessProvider === 'custom';

  return (
    <div>
      <h3 className="text-base font-semibold mb-1 text-foreground">
        Livepeer Inference Configuration
      </h3>
      <p className="text-muted-foreground text-sm mb-5">
        Configure how your AI inference service connects to the Livepeer network.
      </p>

      {/* Topology selection */}
      <div className="mb-5">
        <label className="text-xs font-medium block mb-2 text-muted-foreground">Deployment Topology *</label>
        <div className="flex flex-col gap-2">
          {TOPOLOGIES.map((t) => (
            <button
              key={t.id}
              data-testid={`topology-${t.id}`}
              onClick={() => onChange('topology', t.id)}
              className={`py-3 px-4 rounded-lg cursor-pointer text-left text-foreground transition-all ${
                config.topology === t.id
                  ? 'border-2 border-foreground bg-secondary'
                  : 'border border-border bg-card hover:border-muted-foreground/30'
              }`}
            >
              <div className="font-medium text-sm">{t.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Serverless provider config */}
      {isServerless && (
        <div className="p-4 bg-secondary rounded-lg mb-5">
          <div className="mb-4">
            <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Inference Provider *</label>
            <select
              value={config.serverlessProvider}
              onChange={(e) => onChange('serverlessProvider', e.target.value)}
              data-testid="serverless-provider"
              className="w-full max-w-xs h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
            >
              <option value="">Select provider...</option>
              {SERVERLESS_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {config.serverlessProvider && !isCustomProvider && (
            <>
              <div className="mb-4">
                <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Model *</label>
                <ModelPresetPicker
                  presets={getPresetsForProvider(config.serverlessProvider)}
                  value={config.serverlessModelId}
                  onSelect={(preset: ModelPreset) => onChange('serverlessModelId', preset.modelId)}
                  onCustomValue={(v) => onChange('serverlessModelId', v)}
                  placeholder="Search models or type a custom model ID..."
                />
                {config.serverlessModelId && (
                  <div className="text-xs text-muted-foreground mt-1 font-mono">
                    {config.serverlessModelId}
                  </div>
                )}
              </div>
              <div className="mb-4">
                <label className="text-xs font-medium block mb-1.5 text-muted-foreground">API Key *</label>
                <input
                  type="password"
                  value={config.serverlessApiKey}
                  onChange={(e) => onChange('serverlessApiKey', e.target.value)}
                  placeholder="Your provider API key"
                  data-testid="serverless-api-key"
                  className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
                />
              </div>
            </>
          )}

          {isCustomProvider && (
            <>
              <div className="mb-4">
                <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Endpoint URL *</label>
                <input
                  type="text"
                  value={config.serverlessEndpointUrl}
                  onChange={(e) => onChange('serverlessEndpointUrl', e.target.value)}
                  placeholder="https://your-service.example.com/api"
                  data-testid="serverless-endpoint-url"
                  className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
                />
              </div>
              <div className="mb-4">
                <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Model ID (optional)</label>
                <input
                  type="text"
                  value={config.serverlessModelId}
                  onChange={(e) => onChange('serverlessModelId', e.target.value)}
                  placeholder="Model identifier"
                  className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Model image for self-hosted */}
      {needsModel && (
        <div className="p-4 bg-secondary rounded-lg mb-5">
          <div className="mb-4">
            <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Model *</label>
            <ModelPresetPicker
              presets={getSelfHostedPresets()}
              value={config.serverlessModelId}
              onSelect={(preset: ModelPreset) => {
                onChange('serverlessModelId', preset.modelId);
                if (preset.dockerImage) onChange('modelImage', preset.dockerImage);
              }}
              onCustomValue={(v) => onChange('serverlessModelId', v)}
              placeholder="Search models or type a custom model ID..."
            />
            {config.serverlessModelId && (
              <div className="text-xs text-muted-foreground mt-1 font-mono">
                {config.serverlessModelId}
              </div>
            )}
          </div>
          <div className="mb-4">
            <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Docker Image {config.modelImage ? '' : '*'}</label>
            <input
              type="text"
              value={config.modelImage}
              onChange={(e) => onChange('modelImage', e.target.value)}
              placeholder="ghcr.io/huggingface/text-generation-inference:latest"
              data-testid="model-image"
              className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
            />
            {config.modelImage && (
              <div className="text-xs text-muted-foreground mt-1">
                Auto-filled from preset. Override if needed.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Advanced settings */}
      <div className="mb-5">
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground mb-3">
            Advanced Settings
          </summary>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Capacity</label>
              <input
                type="number"
                min={1}
                max={100}
                value={config.capacity}
                onChange={(e) => onChange('capacity', parseInt(e.target.value, 10) || 1)}
                data-testid="capacity"
                className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Price Per Unit</label>
              <input
                type="number"
                min={0}
                value={config.pricePerUnit}
                onChange={(e) => onChange('pricePerUnit', parseInt(e.target.value, 10) || 0)}
                className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Public Address</label>
              <input
                type="text"
                value={config.publicAddress}
                onChange={(e) => onChange('publicAddress', e.target.value)}
                placeholder="203.0.113.1:7935"
                className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Capability Name (auto-derived)</label>
              <input
                type="text"
                value={config.capabilityName}
                onChange={(e) => onChange('capabilityName', e.target.value)}
                placeholder="Leave blank to auto-derive from model"
                data-testid="capability-name"
                className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
              />
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};

/**
 * ConnectorWizardPage — 3-step wizard for creating/editing a connector.
 * Step 1: Connect (URL, auth, secrets)
 * Step 2: Endpoints (add routes)
 * Step 3: Review & Publish
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGatewayApi } from '../hooks/useGatewayApi';
import { SecretField } from '../components/SecretField';
import { TeamGuard } from '../components/TeamGuard';

const STEPS = ['Connect', 'Endpoints', 'Review'];
const AUTH_TYPES = ['none', 'bearer', 'header', 'basic', 'query'] as const;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', icon: '🔒', desc: 'Only you can access this connector' },
  { value: 'team', label: 'Team', icon: '👥', desc: 'All team members can access' },
  { value: 'public', label: 'Public', icon: '🌐', desc: 'Anyone with an API key can access' },
] as const;

interface EndpointForm {
  name: string;
  method: string;
  path: string;
  upstreamPath: string;
  upstreamContentType: string;
  bodyTransform: string;
}

export const ConnectorWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const template = searchParams.get('template');
  const api = useGatewayApi();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latencyMs?: number; error?: string } | null>(null);

  // Step 1: Connect
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [upstreamBaseUrl, setUpstreamBaseUrl] = useState('');
  const [visibility, setVisibility] = useState<string>('private');
  const [authType, setAuthType] = useState<string>('none');
  const [healthCheckPath, setHealthCheckPath] = useState('');
  const [streamingEnabled, setStreamingEnabled] = useState(false);
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  // Step 2: Endpoints
  const [endpoints, setEndpoints] = useState<EndpointForm[]>([]);

  // Load template
  useEffect(() => {
    if (template === 'ai-llm') {
      setDisplayName('AI / LLM API');
      setSlug('ai-llm');
      setDescription('OpenAI-compatible LLM inference API');
      setAuthType('bearer');
      setStreamingEnabled(true);
      setEndpoints([
        { name: 'Chat', method: 'POST', path: '/chat', upstreamPath: '/v1/chat/completions', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
        { name: 'Completions', method: 'POST', path: '/completions', upstreamPath: '/v1/completions', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
        { name: 'Models', method: 'GET', path: '/models', upstreamPath: '/v1/models', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
      ]);
    } else if (template === 'clickhouse') {
      setDisplayName('ClickHouse');
      setSlug('clickhouse');
      setDescription('ClickHouse analytics query API');
      setAuthType('basic');
      setEndpoints([
        { name: 'Query', method: 'POST', path: '/query', upstreamPath: '/', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
        { name: 'Tables', method: 'GET', path: '/tables', upstreamPath: '/?query=SHOW+TABLES', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
      ]);
    }
  }, [template]);

  const handleSecretChange = useCallback((name: string, value: string) => {
    setSecrets((prev) => ({ ...prev, [name]: value }));
  }, []);

  const addEndpoint = () => {
    setEndpoints((prev) => [
      ...prev,
      { name: '', method: 'GET', path: '/', upstreamPath: '/', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
    ]);
  };

  const updateEndpoint = (index: number, field: keyof EndpointForm, value: string) => {
    setEndpoints((prev) => prev.map((ep, i) => (i === index ? { ...ep, [field]: value } : ep)));
  };

  const removeEndpoint = (index: number) => {
    setEndpoints((prev) => prev.filter((_, i) => i !== index));
  };

  const isUrlValid = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const canProceed = () => {
    if (step === 0) return slug && displayName && upstreamBaseUrl && isUrlValid(upstreamBaseUrl);
    if (step === 1) return endpoints.length > 0 && endpoints.every((ep) => ep.name && ep.path && ep.upstreamPath);
    return true;
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Create draft connector first to test
      const res = await api.post<{ success: boolean; data: { id: string } }>('/connectors', {
        slug,
        displayName,
        description,
        visibility,
        upstreamBaseUrl,
        authType,
        healthCheckPath: healthCheckPath || undefined,
        streamingEnabled,
        secretRefs: Object.keys(secrets),
      });
      if (res.success) {
        const testRes = await api.post<{ success: boolean; data: { success: boolean; latencyMs: number; error: string | null } }>(
          `/connectors/${res.data.id}/test`
        );
        setTestResult(testRes.data);
      }
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (publish: boolean) => {
    setSaving(true);
    try {
      // Create connector
      const connRes = await api.post<{ success: boolean; data: { id: string } }>('/connectors', {
        slug,
        displayName,
        description,
        visibility,
        upstreamBaseUrl,
        authType,
        healthCheckPath: healthCheckPath || undefined,
        streamingEnabled,
        secretRefs: Object.keys(secrets),
      });

      if (!connRes.success) return;
      const connectorId = connRes.data.id;

      // Create endpoints
      for (const ep of endpoints) {
        await api.post(`/connectors/${connectorId}/endpoints`, ep);
      }

      // Publish if requested
      if (publish) {
        await api.post(`/connectors/${connectorId}/publish`);
      }

      navigate(`/connectors/${connectorId}`);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TeamGuard>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Stepper */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                  i === step
                    ? 'bg-blue-600 text-white'
                    : i < step
                    ? 'bg-green-600/20 text-green-400'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                <span className="w-5 h-5 flex items-center justify-center text-xs">{i < step ? '✓' : i + 1}</span>
                {s}
              </div>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-700" />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Connect */}
        {step === 0 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-200">Connect to Upstream Service</h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-300">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="My ClickHouse API"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-300">Slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="my-clickhouse"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-300">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-300">Visibility</label>
              <div className="grid grid-cols-3 gap-3">
                {VISIBILITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setVisibility(opt.value)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      visibility === opt.value
                        ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{opt.icon}</span>
                      <span className="text-sm font-medium text-gray-200">{opt.label}</span>
                    </div>
                    <p className="text-xs text-gray-400">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-300">Upstream Base URL</label>
              <div className="relative">
                <input
                  type="url"
                  value={upstreamBaseUrl}
                  onChange={(e) => setUpstreamBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:ring-2 focus:ring-blue-500 pr-8"
                />
                {upstreamBaseUrl && (
                  <span className={`absolute right-3 top-2.5 text-sm ${isUrlValid(upstreamBaseUrl) ? 'text-green-400' : 'text-red-400'}`}>
                    {isUrlValid(upstreamBaseUrl) ? '✓' : '✗'}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-300">Auth Type</label>
              <select
                value={authType}
                onChange={(e) => setAuthType(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
              >
                {AUTH_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === 'none' ? 'None' : t === 'bearer' ? 'Bearer Token' : t === 'header' ? 'Custom Headers' : t === 'basic' ? 'Basic Auth' : 'Query Param'}
                  </option>
                ))}
              </select>
            </div>

            {authType === 'bearer' && (
              <SecretField label="API Token" name="token" onChange={handleSecretChange} />
            )}
            {authType === 'basic' && (
              <>
                <SecretField label="Username" name="username" onChange={handleSecretChange} />
                <SecretField label="Password" name="password" onChange={handleSecretChange} />
              </>
            )}

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={streamingEnabled}
                  onChange={(e) => setStreamingEnabled(e.target.checked)}
                  className="rounded bg-gray-800 border-gray-600"
                />
                Enable SSE streaming
              </label>
            </div>
          </div>
        )}

        {/* Step 2: Endpoints */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-200">Configure Endpoints</h2>
              <button
                onClick={addEndpoint}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors"
              >
                + Add Endpoint
              </button>
            </div>

            {endpoints.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">
                No endpoints yet. Click "Add Endpoint" to create one.
              </div>
            )}

            {endpoints.map((ep, i) => (
              <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-300">Endpoint {i + 1}</span>
                  <button
                    onClick={() => removeEndpoint(i)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs text-gray-400">Name</label>
                    <input
                      type="text"
                      value={ep.name}
                      onChange={(e) => updateEndpoint(i, 'name', e.target.value)}
                      placeholder="Query"
                      className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs text-gray-400">Method</label>
                    <select
                      value={ep.method}
                      onChange={(e) => updateEndpoint(i, 'method', e.target.value)}
                      className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 text-sm"
                    >
                      {HTTP_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs text-gray-400">Consumer Path</label>
                    <input
                      type="text"
                      value={ep.path}
                      onChange={(e) => updateEndpoint(i, 'path', e.target.value)}
                      placeholder="/query"
                      className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs text-gray-400">Upstream Path</label>
                  <input
                    type="text"
                    value={ep.upstreamPath}
                    onChange={(e) => updateEndpoint(i, 'upstreamPath', e.target.value)}
                    placeholder="/"
                    className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 3: Review */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-200">Review & Publish</h2>

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5 space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-400">Name:</span>
                  <span className="ml-2 text-gray-200">{displayName}</span>
                </div>
                <div>
                  <span className="text-gray-400">Slug:</span>
                  <span className="ml-2 text-gray-200 font-mono">{slug}</span>
                </div>
                <div>
                  <span className="text-gray-400">URL:</span>
                  <span className="ml-2 text-gray-200 font-mono text-xs">{upstreamBaseUrl}</span>
                </div>
                <div>
                  <span className="text-gray-400">Auth:</span>
                  <span className="ml-2 text-gray-200">{authType}</span>
                </div>
                <div>
                  <span className="text-gray-400">Visibility:</span>
                  <span className="ml-2 text-gray-200 capitalize">{visibility}</span>
                </div>
              </div>
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Endpoints ({endpoints.length})</h3>
              <div className="space-y-2">
                {endpoints.map((ep, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded font-mono text-xs">{ep.method}</span>
                    <span className="text-gray-200">{ep.name}</span>
                    <span className="text-gray-500 font-mono text-xs">{ep.path} → {ep.upstreamPath}</span>
                  </div>
                ))}
              </div>
            </div>

            {testResult && (
              <div className={`p-3 rounded-lg text-sm ${testResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                {testResult.success
                  ? `✓ Connection successful (${testResult.latencyMs}ms)`
                  : `✗ Connection failed: ${testResult.error}`}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-700">
          <button
            onClick={() => (step > 0 ? setStep(step - 1) : navigate('/'))}
            className="px-4 py-2 text-gray-400 hover:text-gray-200 text-sm transition-colors"
          >
            {step > 0 ? '← Back' : '← Cancel'}
          </button>
          <div className="flex gap-3">
            {step === 2 && (
              <>
                <button
                  onClick={() => handleSave(false)}
                  disabled={saving}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  Save as Draft
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Publishing...' : 'Publish'}
                </button>
              </>
            )}
            {step < 2 && (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canProceed()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </TeamGuard>
  );
};

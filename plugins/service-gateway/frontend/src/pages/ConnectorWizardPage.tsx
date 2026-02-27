/**
 * ConnectorWizardPage — 4-step wizard for creating a connector.
 * Step 0: Choose Template (multi-select from JSON templates, or skip)
 * Step 1: Connect (URL, auth, secrets)
 * Step 2: Endpoints (add routes)
 * Step 3: Review & Publish
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGatewayApi, useAsync } from '../hooks/useGatewayApi';
import { SecretField } from '../components/SecretField';

const WIZARD_STEPS = ['Template', 'Connect', 'Endpoints', 'Review'];
const AUTH_TYPES = ['none', 'bearer', 'header', 'basic', 'query'] as const;
const DEFAULT_SECRET_REFS: Record<string, string[]> = {
  none: [],
  bearer: ['token'],
  header: ['apiKey'],
  basic: ['username', 'password'],
  query: ['apiKey'],
};
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', icon: '🔒', desc: 'Only you can access this connector' },
  { value: 'team', label: 'Team', icon: '👥', desc: 'All team members can access' },
  { value: 'public', label: 'Public', icon: '🌐', desc: 'Anyone with an API key can access' },
] as const;

const CATEGORY_META: Record<string, { label: string; icon: string; color: string }> = {
  ai:        { label: 'AI & ML',     icon: '🤖', color: 'bg-violet-500/10 text-violet-400 border-violet-500/30' },
  video:     { label: 'Video',       icon: '🎬', color: 'bg-pink-500/10 text-pink-400 border-pink-500/30' },
  database:  { label: 'Database',    icon: '🗄️', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  storage:   { label: 'Storage',     icon: '📦', color: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' },
  payments:  { label: 'Payments',    icon: '💳', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  messaging: { label: 'Messaging',   icon: '📡', color: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
  email:     { label: 'Email',       icon: '✉️', color: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
};

interface TemplateEndpoint {
  name: string;
  method: string;
  path: string;
  upstreamPath: string;
  upstreamContentType: string;
  bodyTransform: string;
}

interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  slug: string;
  authType: string;
  endpointCount: number;
  upstreamBaseUrl: string;
  secretRefs: string[];
  endpoints: TemplateEndpoint[];
}

interface EndpointForm {
  name: string;
  method: string;
  path: string;
  upstreamPath: string;
  upstreamContentType: string;
  bodyTransform: string;
}

interface TemplatesResponse {
  success: boolean;
  data: TemplateSummary[];
}

interface BatchCreateResponse {
  success: boolean;
  data: {
    created: number;
    failed: number;
    results: Array<{
      templateId: string;
      name: string;
      connectorId?: string;
      slug?: string;
      error?: string;
    }>;
    message: string;
  };
}

export const ConnectorWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const api = useGatewayApi();
  const { data: templatesData, loading: templatesLoading, execute: loadTemplates } = useAsync<TemplatesResponse>();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Step 0: Template selection
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>('');

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
  const [secretRefs, setSecretRefs] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Step 2: Endpoints
  const [endpoints, setEndpoints] = useState<EndpointForm[]>([]);

  const { get: apiGet } = api;
  useEffect(() => {
    loadTemplates(() => apiGet('/templates'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const templates = templatesData?.data || [];

  const filteredTemplates = useMemo(() => {
    if (!categoryFilter) return templates;
    return templates.filter((t) => t.category === categoryFilter);
  }, [templates, categoryFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of templates) {
      counts[t.category] = (counts[t.category] || 0) + 1;
    }
    return counts;
  }, [templates]);

  const toggleTemplate = (id: string) => {
    setSelectedTemplateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyTemplateToWizard = (t: TemplateSummary) => {
    setSlug(t.slug);
    setDisplayName(t.name);
    setDescription(t.description);
    setUpstreamBaseUrl(t.upstreamBaseUrl);
    setAuthType(t.authType);
    setSecretRefs(t.secretRefs.length > 0 ? t.secretRefs : DEFAULT_SECRET_REFS[t.authType] || []);
    setEndpoints(
      t.endpoints.map((ep) => ({
        name: ep.name,
        method: ep.method,
        path: ep.path,
        upstreamPath: ep.upstreamPath,
        upstreamContentType: ep.upstreamContentType || 'application/json',
        bodyTransform: ep.bodyTransform || 'passthrough',
      })),
    );
  };

  const handleTestConnection = async () => {
    if (!upstreamBaseUrl || !isUrlValid(upstreamBaseUrl)) return;
    setTesting(true);
    setTestResult(null);
    const start = Date.now();
    try {
      const target = healthCheckPath
        ? new URL(healthCheckPath, upstreamBaseUrl).toString()
        : upstreamBaseUrl;
      const res = await fetch(target, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(10_000) });
      const latencyMs = Date.now() - start;
      setTestResult({ ok: true, latencyMs });
    } catch (err) {
      const latencyMs = Date.now() - start;
      setTestResult({ ok: false, latencyMs, error: err instanceof Error ? err.message : 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleAuthTypeChange = useCallback((newAuthType: string) => {
    setAuthType(newAuthType);
    if (selectedTemplateIds.size === 0) {
      setSecretRefs(DEFAULT_SECRET_REFS[newAuthType] || []);
    }
  }, [selectedTemplateIds]);

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
    try { new URL(url); return true; } catch { return false; }
  };

  const canProceed = () => {
    if (step === 0) return true;
    if (step === 1) return slug && displayName && upstreamBaseUrl && isUrlValid(upstreamBaseUrl);
    if (step === 2) return endpoints.length > 0 && endpoints.every((ep) => ep.name && ep.path && ep.upstreamPath);
    return true;
  };

  const handleBatchCreate = async () => {
    setSaving(true);
    setBatchError(null);
    try {
      const res = await api.post<BatchCreateResponse>('/templates', {
        templateIds: Array.from(selectedTemplateIds),
      });
      if (res.success) {
        const data = (res as unknown as BatchCreateResponse).data;
        if (data.failed > 0) {
          const errs = data.results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`);
          setBatchError(errs.join('; '));
        }
        if (data.created > 0) {
          navigate('/');
        }
      }
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Batch create failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (publish: boolean) => {
    setSaving(true);
    setSaveError(null);
    try {
      const connRes = await api.post<{ success: boolean; data: { id: string } }>('/connectors', {
        slug,
        displayName,
        description,
        visibility,
        upstreamBaseUrl,
        authType,
        healthCheckPath: healthCheckPath || undefined,
        streamingEnabled,
        secretRefs,
      });

      if (!connRes.success) return;
      const connectorId = connRes.data.id;

      for (const ep of endpoints) {
        await api.post(`/connectors/${connectorId}/endpoints`, ep);
      }

      if (publish) {
        await api.post(`/connectors/${connectorId}/publish`);
      }

      navigate(`/connectors/${connectorId}`);
    } catch (err: unknown) {
      const apiErr = err as { message?: string; status?: number; code?: string };
      const status = apiErr.status;
      const msg = apiErr.message || (err instanceof Error ? err.message : 'Save failed');
      if (status === 409 || msg.toLowerCase().includes('already exists')) {
        setSaveError(`A connector with slug "${slug}" already exists. Please choose a different slug.`);
        setStep(1);
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleNext = () => {
    if (step === 0) {
      if (selectedTemplateIds.size > 1) {
        handleBatchCreate();
        return;
      }
      if (selectedTemplateIds.size === 1) {
        const templateId = Array.from(selectedTemplateIds)[0];
        const t = templates.find((t) => t.id === templateId);
        if (t) applyTemplateToWizard(t);
      }
    }
    setStep(step + 1);
  };

  const stepIndex = step;
  const displayedSteps = selectedTemplateIds.size > 1
    ? ['Template']
    : WIZARD_STEPS;

  return (
    <div className="p-6 max-w-4xl mx-auto">
        {/* Stepper */}
        <div className="flex items-center gap-2 mb-8">
          {displayedSteps.map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                  i === stepIndex
                    ? 'bg-blue-600 text-white'
                    : i < stepIndex
                    ? 'bg-green-600/20 text-green-400'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                <span className="w-5 h-5 flex items-center justify-center text-xs">{i < stepIndex ? '✓' : i + 1}</span>
                {s}
              </div>
              {i < displayedSteps.length - 1 && <div className="flex-1 h-px bg-gray-700" />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 0: Template Picker */}
        {step === 0 && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-200">Choose a Template</h2>
                <p className="text-sm text-gray-400 mt-1">
                  Select one or more pre-configured connectors, or skip to create from scratch.
                </p>
              </div>
              {selectedTemplateIds.size > 0 && (
                <span className="px-3 py-1 bg-blue-500/20 text-blue-400 text-sm font-medium rounded-full">
                  {selectedTemplateIds.size} selected
                </span>
              )}
            </div>

            {/* Category Filter Pills */}
            {Object.keys(categoryCounts).length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setCategoryFilter('')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    !categoryFilter
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  All ({templates.length})
                </button>
                {Object.entries(CATEGORY_META).map(([key, meta]) => {
                  const count = categoryCounts[key];
                  if (!count) return null;
                  return (
                    <button
                      key={key}
                      onClick={() => setCategoryFilter(categoryFilter === key ? '' : key)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                        categoryFilter === key
                          ? meta.color
                          : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      {meta.icon} {meta.label} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Templates Loading */}
            {templatesLoading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 animate-pulse">
                    <div className="h-5 bg-gray-700 rounded w-3/4 mb-2" />
                    <div className="h-4 bg-gray-700 rounded w-full mb-3" />
                    <div className="h-3 bg-gray-700 rounded w-1/3" />
                  </div>
                ))}
              </div>
            )}

            {/* Templates Grid */}
            {!templatesLoading && filteredTemplates.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredTemplates.map((t) => {
                  const isSelected = selectedTemplateIds.has(t.id);
                  const catMeta = CATEGORY_META[t.category];
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTemplate(t.id)}
                      className={`text-left p-4 rounded-lg border transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/50'
                          : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{t.icon}</span>
                          <h3 className="text-sm font-semibold text-gray-200 leading-tight">{t.name}</h3>
                        </div>
                        <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-gray-600'
                        }`}>
                          {isSelected && <span className="text-[10px]">✓</span>}
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 mb-3 line-clamp-2">{t.description}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {catMeta && (
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${catMeta.color}`}>
                            {catMeta.label}
                          </span>
                        )}
                        <span>{t.endpointCount} endpoint{t.endpointCount !== 1 ? 's' : ''}</span>
                        <span>·</span>
                        <span>{t.authType === 'none' ? 'No auth' : t.authType}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Batch Error */}
            {batchError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {batchError}
              </div>
            )}
          </div>
        )}

        {/* Step 1: Connect */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-200">Connect to Upstream Service</h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-300">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="My API"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-300">Slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="my-api"
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
              {upstreamBaseUrl && /YOUR_/i.test(upstreamBaseUrl) && (
                <div className="flex items-center gap-1.5 mt-1 text-amber-400 text-xs">
                  <span className="px-1.5 py-0.5 bg-amber-500/20 border border-amber-500/30 rounded font-medium">Placeholder</span>
                  Replace YOUR_* values with real configuration before publishing.
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-300">Auth Type</label>
              <select
                value={authType}
                onChange={(e) => handleAuthTypeChange(e.target.value)}
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

            {/* Test Connection */}
            {upstreamBaseUrl && isUrlValid(upstreamBaseUrl) && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                {testResult && (
                  <span className={`text-sm font-medium ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                    {testResult.ok
                      ? `Connected (${testResult.latencyMs}ms)`
                      : `Failed: ${testResult.error}`}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Endpoints */}
        {step === 2 && (
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

            {selectedTemplateIds.size === 1 && endpoints.length > 0 && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 text-blue-400 text-xs">
                Pre-filled from template. You can edit, remove, or add more endpoints.
              </div>
            )}

            {endpoints.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">
                No endpoints yet. Click &quot;Add Endpoint&quot; to create one.
              </div>
            )}

            {endpoints.map((ep, i) => (
              <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-300">Endpoint {i + 1}</span>
                  <button onClick={() => removeEndpoint(i)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs text-gray-400">Name</label>
                    <input type="text" value={ep.name} onChange={(e) => updateEndpoint(i, 'name', e.target.value)} placeholder="Query" className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs text-gray-400">Method</label>
                    <select value={ep.method} onChange={(e) => updateEndpoint(i, 'method', e.target.value)} className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 text-sm">
                      {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs text-gray-400">Consumer Path</label>
                    <input type="text" value={ep.path} onChange={(e) => updateEndpoint(i, 'path', e.target.value)} placeholder="/query" className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs text-gray-400">Upstream Path</label>
                  <input type="text" value={ep.upstreamPath} onChange={(e) => updateEndpoint(i, 'upstreamPath', e.target.value)} placeholder="/" className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 text-sm" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-200">Review & Publish</h2>

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5 space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-400">Name:</span><span className="ml-2 text-gray-200">{displayName}</span></div>
                <div><span className="text-gray-400">Slug:</span><span className="ml-2 text-gray-200 font-mono">{slug}</span></div>
                <div><span className="text-gray-400">URL:</span><span className="ml-2 text-gray-200 font-mono text-xs">{upstreamBaseUrl}</span></div>
                <div><span className="text-gray-400">Auth:</span><span className="ml-2 text-gray-200">{authType}</span></div>
                <div><span className="text-gray-400">Visibility:</span><span className="ml-2 text-gray-200 capitalize">{visibility}</span></div>
              </div>
            </div>

            {secretRefs.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-amber-400 text-sm flex items-start gap-2">
                <span className="mt-0.5">🔑</span>
                <span>
                  This connector requires upstream credentials ({secretRefs.join(', ')}).
                  You can configure them in Settings after creation.
                </span>
              </div>
            )}

            {endpoints.length > 0 && (
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
            )}
          </div>
        )}

        {/* Save Error */}
        {saveError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mt-4">
            {saveError}
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
            {step === 0 && (
              <button
                onClick={() => { setSelectedTemplateIds(new Set()); setStep(1); }}
                className="px-4 py-2 text-gray-400 hover:text-gray-200 text-sm transition-colors"
              >
                Skip — Create from Scratch
              </button>
            )}
            {step === 3 && (
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
            {step < 3 && (
              <button
                onClick={handleNext}
                disabled={!canProceed() || saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {step === 0 && selectedTemplateIds.size > 1
                  ? saving ? 'Creating...' : `Create ${selectedTemplateIds.size} Connectors`
                  : 'Next →'}
              </button>
            )}
          </div>
        </div>
      </div>
  );
};

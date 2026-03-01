/**
 * ConnectorDetailPage — View and manage a single connector.
 * Tabs: Overview (docs + code snippets), API Keys, Usage, Settings
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGatewayApi, useAsync } from '../hooks/useGatewayApi';
import { QuickStart } from '../components/QuickStart';
import { HealthDot } from '../components/HealthDot';

interface Connector {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  status: string;
  visibility?: string;
  ownerUserId?: string | null;
  teamId?: string | null;
  version: number;
  upstreamBaseUrl: string;
  authType: string;
  streamingEnabled: boolean;
  publishedAt: string | null;
  healthStatus?: string;
  healthLatencyMs?: number | null;
  lastCheckedAt?: string | null;
  endpoints: Array<{
    id: string;
    name: string;
    method: string;
    path: string;
    upstreamPath: string;
    enabled: boolean;
  }>;
}

const VISIBILITY_BADGES: Record<string, { label: string; className: string }> = {
  private: { label: '🔒 Private', className: 'bg-gray-500/10 text-gray-400' },
  team: { label: '👥 Team', className: 'bg-purple-500/10 text-purple-400' },
  public: { label: '🌐 Public', className: 'bg-blue-500/10 text-blue-400' },
};

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
}

const TABS = ['Overview', 'API Spec', 'API Keys', 'Usage', 'Settings'] as const;
type Tab = (typeof TABS)[number];

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/10 text-yellow-400',
  published: 'bg-green-500/10 text-green-400',
  archived: 'bg-gray-500/10 text-gray-400',
  active: 'bg-green-500/10 text-green-400',
  revoked: 'bg-red-500/10 text-red-400',
};

export const ConnectorDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const api = useGatewayApi();
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const { data: connectorRes, loading, execute: loadConnector } = useAsync<{ success: boolean; data: Connector }>();
  const { data: keysRes, execute: loadKeys } = useAsync<{ success: boolean; data: ApiKey[] }>();
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyCreating, setKeyCreating] = useState(false);
  const [openApiSpec, setOpenApiSpec] = useState<Record<string, unknown> | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specCopied, setSpecCopied] = useState(false);

  // Secrets state
  const [secrets, setSecrets] = useState<Array<{ name: string; configured: boolean; updatedAt?: string }>>([]);
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [secretSaving, setSecretSaving] = useState<Record<string, boolean>>({});
  const [secretsLoaded, setSecretsLoaded] = useState(false);

  // Usage state
  interface UsageSummary { totalRequests: number; avgLatencyMs: number; errorCount: number; errorRate: number; totalRequestBytes: number; totalResponseBytes: number }
  interface UsageByKey { apiKeyId: string; keyName: string; keyPrefix: string; status: string; plan: { name: string; dailyQuota?: number | null; monthlyQuota?: number | null } | null; requests: number; avgLatencyMs: number }
  interface TimeseriesPoint { timestamp: string; requests: number; errors: number; errorRate: number; avgLatencyMs: number }
  const TIME_RANGES = [
    { label: '1h', from: 60 * 60 * 1000, interval: '5m' },
    { label: '24h', from: 24 * 60 * 60 * 1000, interval: '1h' },
    { label: '7d', from: 7 * 24 * 60 * 60 * 1000, interval: '6h' },
    { label: '30d', from: 30 * 24 * 60 * 60 * 1000, interval: '1d' },
  ] as const;
  const [usageRange, setUsageRange] = useState(1);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [usageByKey, setUsageByKey] = useState<UsageByKey[]>([]);
  const [usageTimeseries, setUsageTimeseries] = useState<TimeseriesPoint[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latencyMs?: number; error?: string; healthStatus?: string } | null>(null);

  const handleTestConnection = async () => {
    if (!id) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ success: boolean; data: { success: boolean; latencyMs: number; error?: string; healthStatus: string } }>(`/connectors/${id}/test`);
      const data = (res as unknown as { data: { success: boolean; latencyMs: number; error?: string; healthStatus: string } }).data;
      setTestResult(data);
      fetchConnector();
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const fetchConnector = useCallback(() => {
    if (!id) return;
    return loadConnector(() => api.get(`/connectors/${id}`));
  }, [id, loadConnector, api]);

  const fetchKeys = useCallback(() => {
    if (!id) return;
    return loadKeys(() => api.get(`/keys?connectorId=${id}`));
  }, [id, loadKeys, api]);

  useEffect(() => {
    fetchConnector();
    fetchKeys();
  }, [fetchConnector, fetchKeys]);

  useEffect(() => {
    if (activeTab !== 'API Spec' || !id || openApiSpec) return;
    setSpecLoading(true);
    api.get<{ openapi: string }>(`/connectors/${id}/openapi`)
      .then((res) => setOpenApiSpec(res as unknown as Record<string, unknown>))
      .catch(() => setOpenApiSpec(null))
      .finally(() => setSpecLoading(false));
  }, [activeTab, id, api, openApiSpec]);

  // Load secrets when Settings tab is active
  const loadSecrets = useCallback(() => {
    if (!id) return;
    api.get<{ success: boolean; data: Array<{ name: string; configured: boolean; updatedAt?: string }> }>(`/connectors/${id}/secrets`)
      .then((res) => {
        const data = (res as { data: Array<{ name: string; configured: boolean; updatedAt?: string }> }).data;
        setSecrets(data || []);
        setSecretsLoaded(true);
      })
      .catch(() => setSecretsLoaded(true));
  }, [id, api]);

  useEffect(() => {
    if (activeTab !== 'Settings' || !id) return;
    if (secretsLoaded) return;
    loadSecrets();
  }, [activeTab, id, secretsLoaded, loadSecrets]);

  // Load usage data
  const loadUsage = useCallback(() => {
    if (!id) return;
    setUsageLoading(true);
    const range = TIME_RANGES[usageRange];
    const from = new Date(Date.now() - range.from).toISOString();
    const params = `connectorId=${id}&from=${from}`;
    Promise.all([
      api.get<{ success: boolean; data: UsageSummary }>(`/usage/summary?${params}`),
      api.get<{ success: boolean; data: UsageByKey[] }>(`/usage/by-key?${params}`),
      api.get<{ success: boolean; data: { points: TimeseriesPoint[] } }>(`/usage/timeseries?${params}&interval=${range.interval}`),
    ]).then(([summaryRes, byKeyRes, tsRes]) => {
      setUsageSummary((summaryRes as { data: UsageSummary }).data || null);
      setUsageByKey((byKeyRes as { data: UsageByKey[] }).data || []);
      setUsageTimeseries(((tsRes as { data: { points: TimeseriesPoint[] } }).data)?.points || []);
    }).catch(() => {}).finally(() => setUsageLoading(false));
  }, [id, api, usageRange]);

  useEffect(() => {
    if (activeTab !== 'Usage' || !id) return;
    loadUsage();
  }, [activeTab, id, loadUsage]);

  const connector = connectorRes?.data;
  const keys = keysRes?.data || [];

  const handleCreateKey = async () => {
    if (!newKeyName || !id) return;
    setKeyCreating(true);
    try {
      const res = await api.post<{ success: boolean; data: { rawKey: string } }>('/keys', {
        name: newKeyName,
        connectorId: id,
      });
      if (res.success) {
        setCreatedKey(res.data.rawKey);
        setNewKeyName('');
        fetchKeys();
      }
    } finally {
      setKeyCreating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    await api.del(`/keys/${keyId}`);
    fetchKeys();
  };

  const handlePublish = async () => {
    if (!id) return;
    await api.post(`/connectors/${id}/publish`);
    fetchConnector();
  };

  const handleArchive = async () => {
    if (!id) return;
    await api.del(`/connectors/${id}`);
    navigate('/');
  };

  if (loading || !connector) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-800 rounded w-1/3" />
          <div className="h-4 bg-gray-800 rounded w-1/2" />
          <div className="h-64 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-200 text-sm">
                ← Back
              </button>
            </div>
            <h1 className="text-2xl font-bold text-gray-100">{connector.displayName}</h1>
            <div className="flex items-center gap-3 mt-2">
              <HealthDot status={connector.healthStatus || 'unknown'} size="md" showLabel />
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${STATUS_COLORS[connector.status]}`}>
                {connector.status}
              </span>
              {connector.visibility && VISIBILITY_BADGES[connector.visibility] && (
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${VISIBILITY_BADGES[connector.visibility].className}`}>
                  {VISIBILITY_BADGES[connector.visibility].label}
                </span>
              )}
              <span className="text-xs text-gray-500 font-mono">{connector.slug}</span>
              <span className="text-xs text-gray-500">v{connector.version}</span>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {testing ? (
                <>
                  <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </button>
            {testResult && (
              <span className={`text-xs font-medium ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {testResult.success
                  ? `Connected (${testResult.latencyMs}ms)`
                  : `Failed: ${testResult.error || 'Unknown error'}`}
              </span>
            )}
            {connector.status === 'draft' && (
              <button
                onClick={handlePublish}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg"
              >
                Publish
              </button>
            )}
            <button
              onClick={() => navigate(`/connectors/${id}/edit`)}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg"
            >
              Edit
            </button>
            <button
              onClick={handleArchive}
              className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm rounded-lg"
            >
              Archive
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-700 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab: Overview */}
        {activeTab === 'Overview' && (
          <div className="space-y-6">
            {connector.description && (
              <p className="text-gray-400 text-sm">{connector.description}</p>
            )}

            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Endpoints</h3>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-4 py-2 text-left text-gray-400 font-medium">Method</th>
                      <th className="px-4 py-2 text-left text-gray-400 font-medium">Path</th>
                      <th className="px-4 py-2 text-left text-gray-400 font-medium">Name</th>
                      <th className="px-4 py-2 text-left text-gray-400 font-medium">Upstream</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connector.endpoints.map((ep) => (
                      <tr key={ep.id} className="border-b border-gray-700/50">
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded font-mono text-xs">{ep.method}</span>
                        </td>
                        <td className="px-4 py-2 font-mono text-gray-200 text-xs">
                          /api/v1/gw/{connector.slug}{ep.path}
                        </td>
                        <td className="px-4 py-2 text-gray-300">{ep.name}</td>
                        <td className="px-4 py-2 font-mono text-gray-500 text-xs">{ep.upstreamPath}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {connector.status === 'published' && (
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Quick Start</h3>
                <QuickStart
                  baseUrl={window.location.origin}
                  connectorSlug={connector.slug}
                  endpoints={connector.endpoints}
                />
              </div>
            )}
          </div>
        )}

        {/* Tab: API Spec */}
        {activeTab === 'API Spec' && (
          <div className="space-y-4">
            {specLoading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-6 bg-gray-800 rounded w-1/4" />
                <div className="h-40 bg-gray-800 rounded" />
              </div>
            ) : openApiSpec ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-300">
                    OpenAPI 3.0.3 Specification
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(openApiSpec, null, 2));
                        setSpecCopied(true);
                        setTimeout(() => setSpecCopied(false), 2000);
                      }}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
                    >
                      {specCopied ? 'Copied!' : 'Copy JSON'}
                    </button>
                    <button
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(openApiSpec, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${connector?.slug || 'spec'}-openapi.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg"
                    >
                      Download
                    </button>
                  </div>
                </div>

                {/* Endpoint Cards */}
                {openApiSpec.paths && typeof openApiSpec.paths === 'object' ? (
                  <div className="space-y-3">
                    {Object.entries(openApiSpec.paths as Record<string, Record<string, Record<string, unknown>>>).map(
                      ([path, methods]) =>
                        Object.entries(methods).map(([method, op]) => (
                          <div
                            key={`${method}-${path}`}
                            className="bg-gray-800/50 border border-gray-700 rounded-lg p-4"
                          >
                            <div className="flex items-center gap-3 mb-2">
                              <span
                                className={`px-2 py-0.5 text-xs font-bold rounded uppercase ${
                                  method === 'get'
                                    ? 'bg-green-500/20 text-green-400'
                                    : method === 'post'
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : method === 'put'
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : method === 'delete'
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'bg-gray-500/20 text-gray-400'
                                }`}
                              >
                                {method}
                              </span>
                              <code className="text-sm text-gray-200 font-mono">{path}</code>
                            </div>
                            {op.summary ? (
                              <p className="text-sm text-gray-300 mb-1">{String(op.summary)}</p>
                            ) : null}
                            {op.description ? (
                              <p className="text-xs text-gray-500 mb-2">{String(op.description)}</p>
                            ) : null}

                            {/* Parameters */}
                            {(() => {
                              const params = op.parameters as Array<Record<string, unknown>> | undefined;
                              if (!Array.isArray(params) || params.length === 0) return null;
                              return (
                                <div className="mt-2">
                                  <p className="text-xs font-semibold text-gray-400 mb-1">Parameters</p>
                                  <div className="space-y-1">
                                    {params.map((param, i) => (
                                      <div key={i} className="flex items-center gap-2 text-xs">
                                        <span className="px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded font-mono">
                                          {String(param.in)}
                                        </span>
                                        <span className="text-gray-300 font-mono">{String(param.name)}</span>
                                        {Boolean(param.required) ? (
                                          <span className="text-red-400 text-[10px]">required</span>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })() as React.ReactNode}

                            {/* Request Body Schema */}
                            {op.requestBody && typeof op.requestBody === 'object' && (
                              <div className="mt-2">
                                <p className="text-xs font-semibold text-gray-400 mb-1">Request Body</p>
                                <pre className="text-xs bg-gray-900 rounded p-2 text-gray-300 overflow-x-auto font-mono">
                                  {JSON.stringify(
                                    Object.values(
                                      ((op.requestBody as Record<string, unknown>).content as Record<string, { schema: unknown }>) || {}
                                    )[0]?.schema || {},
                                    null,
                                    2
                                  )}
                                </pre>
                              </div>
                            )}

                            {/* Extension metadata */}
                            <div className="flex gap-3 mt-2 text-[10px] text-gray-500">
                              {op['x-cache-ttl'] ? <span>Cache: {String(op['x-cache-ttl'])}s</span> : null}
                              {op['x-rate-limit'] ? <span>Rate: {String(op['x-rate-limit'])} req/min</span> : null}
                              {op['x-timeout'] ? <span>Timeout: {String(op['x-timeout'])}ms</span> : null}
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                ) : null}

                {/* Raw JSON viewer */}
                <details className="mt-4">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                    View raw JSON spec
                  </summary>
                  <pre className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded-lg p-4 text-gray-300 overflow-x-auto font-mono max-h-96 overflow-y-auto">
                    {JSON.stringify(openApiSpec, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <div className="text-center py-12 text-gray-400 text-sm">
                Failed to load OpenAPI spec. Make sure the connector is published.
              </div>
            )}
          </div>
        )}

        {/* Tab: API Keys */}
        {activeTab === 'API Keys' && (
          <div className="space-y-4">
            {/* Create Key */}
            <div className="flex gap-3">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g., mobile-app)"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
              />
              <button
                onClick={handleCreateKey}
                disabled={!newKeyName || keyCreating}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                Create Key
              </button>
            </div>

            {/* Newly created key */}
            {createdKey && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <p className="text-sm text-green-400 mb-2 font-medium">API Key Created — copy it now, it won't be shown again!</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-gray-900 rounded text-xs text-gray-200 font-mono">{createdKey}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(createdKey);
                    }}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}

            {/* Keys table */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Name</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Key</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Status</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Last Used</th>
                    <th className="px-4 py-2 text-right text-gray-400 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500 text-sm">
                        No API keys yet. Create one above.
                      </td>
                    </tr>
                  )}
                  {keys.map((key) => (
                    <tr key={key.id} className="border-b border-gray-700/50">
                      <td className="px-4 py-2 text-gray-200">{key.name}</td>
                      <td className="px-4 py-2 font-mono text-gray-400 text-xs">{key.keyPrefix}...</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 text-xs rounded ${STATUS_COLORS[key.status]}`}>{key.status}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {key.status === 'active' && (
                          <button
                            onClick={() => handleRevokeKey(key.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: Usage */}
        {activeTab === 'Usage' && (
          <div className="space-y-6">
            {/* Time range selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Time range:</span>
              <div className="flex gap-1">
                {TIME_RANGES.map((r, i) => (
                  <button
                    key={r.label}
                    onClick={() => setUsageRange(i)}
                    className={`px-3 py-1 text-xs rounded-lg ${
                      usageRange === i
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {usageLoading ? (
              <div className="animate-pulse space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  {[1,2,3,4].map(i => <div key={i} className="h-20 bg-gray-800 rounded-lg" />)}
                </div>
                <div className="h-40 bg-gray-800 rounded-lg" />
              </div>
            ) : (
              <>
                {/* Summary Cards */}
                {usageSummary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <p className="text-xs text-gray-400">Total Requests</p>
                      <p className="text-2xl font-bold text-gray-100 mt-1">{usageSummary.totalRequests.toLocaleString()}</p>
                    </div>
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <p className="text-xs text-gray-400">Avg Latency</p>
                      <p className="text-2xl font-bold text-gray-100 mt-1">{usageSummary.avgLatencyMs}<span className="text-sm text-gray-400 ml-1">ms</span></p>
                    </div>
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <p className="text-xs text-gray-400">Error Rate</p>
                      <p className={`text-2xl font-bold mt-1 ${usageSummary.errorRate > 5 ? 'text-red-400' : 'text-green-400'}`}>
                        {usageSummary.errorRate}%
                      </p>
                    </div>
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <p className="text-xs text-gray-400">Data Transferred</p>
                      <p className="text-2xl font-bold text-gray-100 mt-1">
                        {(() => {
                          const bytes = usageSummary.totalRequestBytes + usageSummary.totalResponseBytes;
                          if (bytes >= 1024 * 1024 * 1024) return <>{(bytes / (1024 * 1024 * 1024)).toFixed(1)}<span className="text-sm text-gray-400 ml-1">GB</span></>;
                          if (bytes >= 1024 * 1024) return <>{(bytes / (1024 * 1024)).toFixed(1)}<span className="text-sm text-gray-400 ml-1">MB</span></>;
                          if (bytes >= 1024) return <>{(bytes / 1024).toFixed(1)}<span className="text-sm text-gray-400 ml-1">KB</span></>;
                          return <>{bytes}<span className="text-sm text-gray-400 ml-1">B</span></>;
                        })()}
                      </p>
                    </div>
                  </div>
                )}

                {/* Timeseries Chart */}
                {usageTimeseries.length > 0 && (
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-gray-300 mb-3">Requests Over Time</h3>
                    <div className="flex items-end gap-px h-32">
                      {(() => {
                        const maxReqs = Math.max(...usageTimeseries.map(p => p.requests), 1);
                        return usageTimeseries.map((point, i) => {
                          const height = (point.requests / maxReqs) * 100;
                          const errorHeight = point.requests > 0 ? (point.errors / point.requests) * height : 0;
                          return (
                            <div
                              key={i}
                              className="flex-1 flex flex-col justify-end group relative min-w-[2px]"
                              style={{ height: '100%' }}
                            >
                              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-gray-300 whitespace-nowrap z-10">
                                {new Date(point.timestamp).toLocaleString()}<br/>
                                {point.requests} req, {point.errors} err
                              </div>
                              {errorHeight > 0 && (
                                <div className="w-full bg-red-500/60 rounded-t-sm" style={{ height: `${errorHeight}%` }} />
                              )}
                              <div className="w-full bg-green-500/60 rounded-t-sm" style={{ height: `${Math.max(height - errorHeight, 0)}%` }} />
                            </div>
                          );
                        });
                      })()}
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                      <span>{usageTimeseries.length > 0 ? new Date(usageTimeseries[0].timestamp).toLocaleTimeString() : ''}</span>
                      <span>{usageTimeseries.length > 0 ? new Date(usageTimeseries[usageTimeseries.length - 1].timestamp).toLocaleTimeString() : ''}</span>
                    </div>
                  </div>
                )}

                {/* Per-API-Key Breakdown */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">Usage by API Key</h3>
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-700">
                          <th className="px-4 py-2 text-left text-gray-400 font-medium">Key Name</th>
                          <th className="px-4 py-2 text-left text-gray-400 font-medium">Prefix</th>
                          <th className="px-4 py-2 text-left text-gray-400 font-medium">Plan</th>
                          <th className="px-4 py-2 text-right text-gray-400 font-medium">Requests</th>
                          <th className="px-4 py-2 text-right text-gray-400 font-medium">Avg Latency</th>
                          <th className="px-4 py-2 text-left text-gray-400 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageByKey.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-sm">
                              No API key usage recorded in this time range.
                            </td>
                          </tr>
                        )}
                        {usageByKey.map((k) => (
                          <tr key={k.apiKeyId} className="border-b border-gray-700/50">
                            <td className="px-4 py-2 text-gray-200">{k.keyName}</td>
                            <td className="px-4 py-2 font-mono text-gray-400 text-xs">{k.keyPrefix}...</td>
                            <td className="px-4 py-2 text-gray-300 text-xs">{k.plan?.name || '-'}</td>
                            <td className="px-4 py-2 text-right text-gray-200">{k.requests.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-gray-300">{k.avgLatencyMs}ms</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 text-xs rounded ${STATUS_COLORS[k.status] || 'bg-gray-500/10 text-gray-400'}`}>
                                {k.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {!usageSummary && usageByKey.length === 0 && (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    No usage data recorded yet. Make some API calls to see analytics here.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab: Settings */}
        {activeTab === 'Settings' && (
          <div className="space-y-4">
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-300">Configuration</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-400">Upstream URL:</span> <span className="text-gray-200 font-mono text-xs ml-1">{connector.upstreamBaseUrl}</span></div>
                <div><span className="text-gray-400">Auth Type:</span> <span className="text-gray-200 ml-1">{connector.authType}</span></div>
                <div><span className="text-gray-400">Streaming:</span> <span className="text-gray-200 ml-1">{connector.streamingEnabled ? 'Enabled' : 'Disabled'}</span></div>
                <div><span className="text-gray-400">Visibility:</span> <span className="text-gray-200 ml-1 capitalize">{connector.visibility || 'private'}</span></div>
                <div><span className="text-gray-400">Endpoints:</span> <span className="text-gray-200 ml-1">{connector.endpoints.length}</span></div>
              </div>
            </div>

            {/* Upstream Auth Status Summary */}
            {secretsLoaded && secrets.length > 0 && (() => {
              const configured = secrets.filter((s) => s.configured).length;
              const total = secrets.length;
              const allDone = configured === total;
              return (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm ${
                  allDone
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-amber-500/10 border-amber-500/30'
                }`}>
                  <span className={`w-2.5 h-2.5 rounded-full ${allDone ? 'bg-green-400' : 'bg-amber-400'}`} />
                  <span className={allDone ? 'text-green-400' : 'text-amber-400'}>
                    Upstream Authentication: {allDone
                      ? 'All secrets configured'
                      : `${total - configured} of ${total} secret${total !== 1 ? 's' : ''} not configured`}
                  </span>
                </div>
              );
            })()}

            {/* Upstream Secrets (owner-only) */}
            {secretsLoaded && secrets.length > 0 && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5 space-y-3">
                <h3 className="text-sm font-semibold text-gray-300">Upstream Secrets</h3>
                <p className="text-xs text-gray-500">
                  Configure API keys and credentials for the upstream service. These are encrypted and only visible to the connector owner.
                </p>
                <div className="space-y-3">
                  {secrets.map((secret) => (
                    <div key={secret.name} className="flex items-center gap-3">
                      <div className="w-24">
                        <span className="text-sm text-gray-300 font-mono">{secret.name}</span>
                      </div>
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        secret.configured
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}>
                        {secret.configured ? 'Configured' : 'Not set'}
                      </span>
                      <input
                        type="password"
                        value={secretInputs[secret.name] || ''}
                        onChange={(e) => setSecretInputs(prev => ({ ...prev, [secret.name]: e.target.value }))}
                        placeholder={secret.configured ? 'Enter new value to update' : 'Enter secret value'}
                        className="flex-1 px-3 py-1.5 bg-gray-900 border border-gray-600 rounded text-gray-200 text-xs font-mono"
                      />
                      <button
                        onClick={async () => {
                          const value = secretInputs[secret.name];
                          if (!value?.trim()) return;
                          setSecretSaving(prev => ({ ...prev, [secret.name]: true }));
                          try {
                            await api.put(`/connectors/${id}/secrets`, { [secret.name]: value });
                            setSecretInputs(prev => ({ ...prev, [secret.name]: '' }));
                            setSecretsLoaded(false);
                          } finally {
                            setSecretSaving(prev => ({ ...prev, [secret.name]: false }));
                          }
                        }}
                        disabled={!secretInputs[secret.name]?.trim() || secretSaving[secret.name]}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded disabled:opacity-50"
                      >
                        {secretSaving[secret.name] ? 'Saving...' : 'Save'}
                      </button>
                      {secret.configured && (
                        <button
                          onClick={async () => {
                            setSecretSaving(prev => ({ ...prev, [secret.name]: true }));
                            try {
                              await api.del(`/connectors/${id}/secrets/${secret.name}`);
                              setSecretsLoaded(false);
                            } finally {
                              setSecretSaving(prev => ({ ...prev, [secret.name]: false }));
                            }
                          }}
                          disabled={secretSaving[secret.name]}
                          className="px-2 py-1.5 text-red-400 hover:text-red-300 text-xs"
                          title="Remove secret"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
  );
};

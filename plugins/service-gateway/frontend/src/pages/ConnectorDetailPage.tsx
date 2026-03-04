/**
 * ConnectorDetailPage — View and manage a single connector.
 * Tabs: Overview (docs + code snippets), API Keys, Usage, Settings
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGatewayApi, useAsync } from '../hooks/useGatewayApi';
import { QuickStart } from '../components/QuickStart';
import { TeamGuard } from '../components/TeamGuard';

interface Connector {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  status: string;
  version: number;
  upstreamBaseUrl: string;
  authType: string;
  streamingEnabled: boolean;
  publishedAt: string | null;
  endpoints: Array<{
    id: string;
    name: string;
    method: string;
    path: string;
    upstreamPath: string;
    enabled: boolean;
  }>;
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
}

const TABS = ['Overview', 'API Keys', 'Usage', 'Settings'] as const;
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
    <TeamGuard>
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
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${STATUS_COLORS[connector.status]}`}>
                {connector.status}
              </span>
              <span className="text-xs text-gray-500 font-mono">{connector.slug}</span>
              <span className="text-xs text-gray-500">v{connector.version}</span>
            </div>
          </div>
          <div className="flex gap-2">
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
          <div className="text-center py-12 text-gray-400 text-sm">
            Usage analytics are available on the Dashboard page.
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
                <div><span className="text-gray-400">Endpoints:</span> <span className="text-gray-200 ml-1">{connector.endpoints.length}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TeamGuard>
  );
};

/**
 * ApiKeysPage — Cross-connector view of all team API keys.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useGatewayApi, useAsync } from '../hooks/useGatewayApi';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
  connector: { id: string; slug: string; displayName: string } | null;
  plan: { id: string; name: string; displayName: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-400',
  revoked: 'bg-red-500/10 text-red-400',
  expired: 'bg-yellow-500/10 text-yellow-400',
};

export const ApiKeysPage: React.FC = () => {
  const api = useGatewayApi();
  const { data, loading, execute } = useAsync<{ success: boolean; data: ApiKey[] }>();
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadKeys = useCallback(() => {
    return execute(() => api.get('/keys'));
  }, [execute, api]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleCreate = async () => {
    if (!newKeyName) return;
    setCreating(true);
    try {
      const res = await api.post<{ success: boolean; data: { rawKey: string } }>('/keys', {
        name: newKeyName,
      });
      if (res.success) {
        setCreatedKey(res.data.rawKey);
        setNewKeyName('');
        loadKeys();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    await api.del(`/keys/${keyId}`);
    loadKeys();
  };

  const keys = data?.data || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-100 mb-6">API Keys</h1>

        {/* Create */}
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="New key name..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
          />
          <button
            onClick={handleCreate}
            disabled={!newKeyName || creating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            Create Key
          </button>
        </div>

        {createdKey && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
            <p className="text-sm text-green-400 mb-2 font-medium">Key created — copy now!</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-gray-900 rounded text-xs text-gray-200 font-mono break-all">{createdKey}</code>
              <button
                onClick={() => navigator.clipboard.writeText(createdKey)}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded shrink-0"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Name</th>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Key</th>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Connector</th>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Plan</th>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Status</th>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Last Used</th>
                <th className="px-4 py-2 text-right text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                </tr>
              )}
              {!loading && keys.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No API keys found.</td>
                </tr>
              )}
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2 text-gray-200">{key.name}</td>
                  <td className="px-4 py-2 font-mono text-gray-400 text-xs">{key.keyPrefix}...</td>
                  <td className="px-4 py-2 text-gray-300 text-xs">{key.connector?.displayName || 'All'}</td>
                  <td className="px-4 py-2 text-gray-300 text-xs">{key.plan?.displayName || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 text-xs rounded ${STATUS_COLORS[key.status] || ''}`}>{key.status}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {key.status === 'active' && (
                      <button onClick={() => handleRevoke(key.id)} className="text-xs text-red-400 hover:text-red-300">
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
  );
};

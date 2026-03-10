/**
 * MasterKeysPage — Manage gateway master API keys (gwm_ prefix).
 * Master keys grant access to all connectors in scope.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useGatewayApi, useAsync } from '../hooks/useGatewayApi';

interface MasterKey {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  scopes: string[];
  allowedIPs: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-400',
  revoked: 'bg-red-500/10 text-red-400',
  expired: 'bg-yellow-500/10 text-yellow-400',
};

const SCOPE_OPTIONS = ['proxy', 'admin', 'discovery'];

export const MasterKeysPage: React.FC = () => {
  const api = useGatewayApi();
  const { data, loading, execute } = useAsync<{ success: boolean; data: MasterKey[] }>();
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['proxy']);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const loadKeys = useCallback(() => {
    return execute(() => api.get('/master-keys'));
  }, [execute, api]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleCreate = async () => {
    if (!newKeyName || selectedScopes.length === 0) return;
    setCreating(true);
    setActionError('');
    try {
      const res = await api.post<{ success: boolean; data: { rawKey: string } }>('/master-keys', {
        name: newKeyName,
        scopes: selectedScopes,
      });
      if (res.success) {
        setCreatedKey(res.data.rawKey);
        setNewKeyName('');
        loadKeys();
      }
    } catch {
      setActionError('Failed to create master key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    setActionError('');
    try {
      await api.del(`/master-keys/${keyId}`);
      loadKeys();
    } catch {
      setActionError('Failed to revoke master key');
    }
  };

  const handleRotate = async (keyId: string) => {
    setActionError('');
    try {
      const res = await api.post<{ success: boolean; data: { rawKey: string } }>(`/master-keys/${keyId}/rotate`);
      if (res.success) {
        setCreatedKey(res.data.rawKey);
        loadKeys();
      }
    } catch {
      setActionError('Failed to rotate master key');
    }
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) => {
      const next = prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope];
      return next.length === 0 ? prev : next;
    });
  };

  const keys = data?.data || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-2">Master Keys</h1>
      <p className="text-sm text-gray-400 mb-6">
        Master keys (gwm_) grant access to all connectors in your scope. Use them for AI agent integrations.
      </p>

      {/* Create */}
      <div className="mb-4 space-y-3">
        <div className="flex gap-3">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="New master key name..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
          />
          <button
            onClick={handleCreate}
            disabled={!newKeyName || selectedScopes.length === 0 || creating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            Create Master Key
          </button>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-400">Scopes:</span>
          {SCOPE_OPTIONS.map((scope) => (
            <label key={scope} className="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedScopes.includes(scope)}
                onChange={() => toggleScope(scope)}
                className="rounded border-gray-600"
              />
              {scope}
            </label>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-400">{actionError}</p>
        </div>
      )}

      {createdKey && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-green-400 mb-2 font-medium">Master key created — copy now!</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-gray-900 rounded text-xs text-gray-200 font-mono break-all">{createdKey}</code>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(createdKey);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch { /* clipboard not available */ }
              }}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
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
              <th className="px-4 py-2 text-left text-gray-400 font-medium">Scopes</th>
              <th className="px-4 py-2 text-left text-gray-400 font-medium">Status</th>
              <th className="px-4 py-2 text-left text-gray-400 font-medium">Last Used</th>
              <th className="px-4 py-2 text-left text-gray-400 font-medium">Created</th>
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
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No master keys found.</td>
              </tr>
            )}
            {keys.map((key) => (
              <tr key={key.id} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                <td className="px-4 py-2 text-gray-200">{key.name}</td>
                <td className="px-4 py-2 font-mono text-gray-400 text-xs">{key.keyPrefix}...</td>
                <td className="px-4 py-2 text-gray-300 text-xs">{key.scopes.join(', ')}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 text-xs rounded ${STATUS_COLORS[key.status] || ''}`}>{key.status}</span>
                </td>
                <td className="px-4 py-2 text-gray-500 text-xs">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-2 text-gray-500 text-xs">
                  {new Date(key.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right space-x-2">
                  {key.status === 'active' && (
                    <>
                      <button onClick={() => handleRotate(key.id)} className="text-xs text-blue-400 hover:text-blue-300">
                        Rotate
                      </button>
                      {confirmRevokeId === key.id ? (
                        <>
                          <span className="text-xs text-red-400">Revoke?</span>
                          <button
                            onClick={() => { handleRevoke(key.id); setConfirmRevokeId(null); }}
                            className="text-xs text-red-400 hover:text-red-300 font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmRevokeId(null)}
                            className="text-xs text-gray-400 hover:text-gray-200"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmRevokeId(key.id)} className="text-xs text-red-400 hover:text-red-300">
                          Revoke
                        </button>
                      )}
                    </>
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

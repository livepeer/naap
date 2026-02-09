'use client';

/**
 * Admin Secrets Management Page
 * Manage system secrets and encryption keys.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Key,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Copy,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { AdminNav } from '@/components/admin/AdminNav';

interface Secret {
  key: string;
  description: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
}

export default function AdminSecretsPage() {
  const router = useRouter();
  const { hasRole } = useAuth();
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSecret, setNewSecret] = useState({ key: '', value: '', description: '', category: 'api' });
  const [adding, setAdding] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isAdmin = hasRole('system:admin');

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
      return;
    }
    loadSecrets();
  }, [isAdmin]);

  async function loadSecrets() {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/secrets');
      const data = await res.json();
      if (data.success) {
        setSecrets(data.data.secrets || []);
      } else {
        setError(data.error?.message || 'Failed to load secrets');
      }
    } catch (err) {
      setError('Failed to load secrets');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddSecret(e: React.FormEvent) {
    e.preventDefault();
    if (!newSecret.key.trim() || !newSecret.value.trim()) return;

    try {
      setAdding(true);
      const res = await fetch('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSecret),
      });
      const data = await res.json();
      if (data.success) {
        setShowAddModal(false);
        setNewSecret({ key: '', value: '', description: '', category: 'api' });
        loadSecrets();
      } else {
        setError(data.error?.message || 'Failed to add secret');
      }
    } catch (err) {
      setError('Failed to add secret');
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteSecret(key: string) {
    if (!confirm(`Are you sure you want to delete the secret "${key}"?`)) return;

    try {
      await fetch(`/api/v1/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' });
      setSecrets(prev => prev.filter(s => s.key !== key));
    } catch (err) {
      setError('Failed to delete secret');
    }
  }

  async function handleRotateSecret(key: string) {
    if (!confirm(`Are you sure you want to rotate the secret "${key}"? This will generate a new value.`)) return;

    try {
      const res = await fetch(`/api/v1/secrets/${encodeURIComponent(key)}/rotate`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        loadSecrets();
      } else {
        setError(data.error?.message || 'Failed to rotate secret');
      }
    } catch (err) {
      setError('Failed to rotate secret');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'api': return 'bg-blue-500/10 text-blue-500';
      case 'database': return 'bg-green-500/10 text-green-500';
      case 'encryption': return 'bg-purple-500/10 text-purple-500';
      case 'integration': return 'bg-orange-500/10 text-orange-500';
      default: return 'bg-gray-500/10 text-gray-500';
    }
  };

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <AdminNav />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key className="w-6 h-6" />
            Secrets Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage system secrets and API keys
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Secret
        </button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">×</button>
        </div>
      )}

      {secrets.length === 0 ? (
        <div className="text-center py-12 bg-muted/50 rounded-xl">
          <Key className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No secrets configured</h3>
          <p className="text-muted-foreground mb-4">
            Add your first secret to get started
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Your First Secret
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {secrets.map(secret => (
            <div
              key={secret.key}
              className="bg-card border border-border rounded-xl p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-mono font-medium">{secret.key}</h3>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${getCategoryColor(secret.category)}`}>
                      {secret.category}
                    </span>
                    <button
                      onClick={() => copyToClipboard(secret.key)}
                      className="p-1 hover:bg-muted rounded transition-colors"
                      title="Copy key"
                    >
                      {copiedKey === secret.key ? (
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                  {secret.description && (
                    <p className="text-sm text-muted-foreground mb-2">{secret.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Created: {new Date(secret.createdAt).toLocaleDateString()}</span>
                    {secret.rotatedAt && (
                      <span>Last rotated: {new Date(secret.rotatedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRotateSecret(secret.key)}
                    className="p-2 hover:bg-muted rounded-lg transition-colors"
                    title="Rotate secret"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteSecret(secret.key)}
                    className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                    title="Delete secret"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Secret Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md m-4 shadow-xl">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              Add New Secret
            </h2>

            <form onSubmit={handleAddSecret} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Secret Key</label>
                <input
                  type="text"
                  value={newSecret.key}
                  onChange={(e) => setNewSecret({ ...newSecret, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                  placeholder="API_KEY_NAME"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Secret Value</label>
                <input
                  type="password"
                  value={newSecret.value}
                  onChange={(e) => setNewSecret({ ...newSecret, value: e.target.value })}
                  placeholder="••••••••••••"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <select
                  value={newSecret.category}
                  onChange={(e) => setNewSecret({ ...newSecret, category: e.target.value })}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="api">API Key</option>
                  <option value="database">Database</option>
                  <option value="encryption">Encryption</option>
                  <option value="integration">Integration</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description (optional)</label>
                <textarea
                  value={newSecret.description}
                  onChange={(e) => setNewSecret({ ...newSecret, description: e.target.value })}
                  rows={2}
                  placeholder="What is this secret used for?"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {adding && <Loader2 className="w-4 h-4 animate-spin" />}
                  Add Secret
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

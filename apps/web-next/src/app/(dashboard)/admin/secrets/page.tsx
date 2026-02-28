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
  AlertTriangle,
  Copy,
  CheckCircle2
} from 'lucide-react';
import { Button, Input, Textarea, Select, Label, Modal, Badge } from '@naap/ui';
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

  const getCategoryBadgeVariant = (category: string): 'blue' | 'emerald' | 'secondary' | 'amber' => {
    switch (category) {
      case 'api': return 'blue';
      case 'database': return 'emerald';
      case 'encryption': return 'secondary';
      case 'integration': return 'amber';
      default: return 'secondary';
    }
  };

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-5 w-5 animate-spin text-muted-foreground border-2 border-current border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <AdminNav />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Key className="w-5 h-5" />
            Secrets Management
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage system secrets and API keys
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setShowAddModal(true)}
        >
          Add Secret
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">x</button>
        </div>
      )}

      {secrets.length === 0 ? (
        <div className="text-center py-8 bg-muted/50 rounded-lg">
          <Key className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-sm font-semibold mb-2">No secrets configured</h3>
          <p className="text-muted-foreground mb-4 text-sm">
            Add your first secret to get started
          </p>
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setShowAddModal(true)}
          >
            Add Your First Secret
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {secrets.map(secret => (
            <div
              key={secret.key}
              className="bg-card border border-border rounded-lg p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-mono font-medium">{secret.key}</h3>
                    <Badge variant={getCategoryBadgeVariant(secret.category)}>
                      {secret.category}
                    </Badge>
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
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Created: {new Date(secret.createdAt).toLocaleDateString()}</span>
                    {secret.rotatedAt && (
                      <span>Last rotated: {new Date(secret.rotatedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw className="w-4 h-4" />}
                    onClick={() => handleRotateSecret(secret.key)}
                    title="Rotate secret"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    icon={<Trash2 className="w-4 h-4" />}
                    onClick={() => handleDeleteSecret(secret.key)}
                    title="Delete secret"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Secret Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New Secret"
        size="md"
      >
        <form onSubmit={handleAddSecret} className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Secret Key</Label>
            <Input
              type="text"
              value={newSecret.key}
              onChange={(e) => setNewSecret({ ...newSecret, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
              placeholder="API_KEY_NAME"
              className="font-mono"
              required
            />
          </div>

          <div>
            <Label className="mb-1.5 block">Secret Value</Label>
            <Input
              type="password"
              value={newSecret.value}
              onChange={(e) => setNewSecret({ ...newSecret, value: e.target.value })}
              placeholder="••••••••••••"
              required
            />
          </div>

          <div>
            <Label className="mb-1.5 block">Category</Label>
            <Select
              value={newSecret.category}
              onChange={(e) => setNewSecret({ ...newSecret, category: e.target.value })}
            >
              <option value="api">API Key</option>
              <option value="database">Database</option>
              <option value="encryption">Encryption</option>
              <option value="integration">Integration</option>
            </Select>
          </div>

          <div>
            <Label className="mb-1.5 block">Description (optional)</Label>
            <Textarea
              value={newSecret.description}
              onChange={(e) => setNewSecret({ ...newSecret, description: e.target.value })}
              rows={2}
              placeholder="What is this secret used for?"
              className="resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowAddModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={adding}
            >
              Add Secret
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

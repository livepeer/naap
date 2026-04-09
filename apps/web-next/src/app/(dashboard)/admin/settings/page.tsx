'use client';

/**
 * Admin Settings Page — Feature Flags
 *
 * Dynamically renders ALL feature flags from the database as toggle rows.
 * Adding a new flag to the DB (via seed or upsert) makes it appear here
 * automatically — no UI code changes required.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button, Toggle } from '@naap/ui';
import { useAuth } from '@/contexts/auth-context';
import { AdminNav } from '@/components/admin/AdminNav';
import { invalidateFeatureFlags } from '@/hooks/use-feature-flags';

interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
}

function humanizeKey(key: string): string {
  return key
    .replace(/^enable/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const { hasRole } = useAuth();

  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [original, setOriginal] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isAdmin = hasRole('system:admin');

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, router]);

  const loadFlags = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/admin/feature-flags', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        const fetched: FeatureFlag[] = data.data.flags;
        setFlags(fetched);
        const orig: Record<string, boolean> = {};
        for (const f of fetched) orig[f.key] = f.enabled;
        setOriginal(orig);
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to load feature flags' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadFlags();
  }, [isAdmin, loadFlags]);

  const hasChanges = flags.some(f => f.enabled !== original[f.key]);

  function handleToggle(key: string, enabled: boolean) {
    setFlags(prev => prev.map(f => (f.key === key ? { ...f, enabled } : f)));
    setFeedback(null);
  }

  async function handleSave() {
    const changed = flags.filter(f => f.enabled !== original[f.key]);
    if (changed.length === 0) return;

    setSaving(true);
    setFeedback(null);

    try {
      const results = await Promise.all(
        changed.map(flag =>
          fetch('/api/v1/admin/feature-flags', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ key: flag.key, enabled: flag.enabled }),
          }).then(res => res.json())
        )
      );
      const failed = results.find(r => !r.success);
      if (failed) {
        throw new Error(failed.error?.message || 'Failed to update flags');
      }

      const newOriginal: Record<string, boolean> = {};
      for (const f of flags) newOriginal[f.key] = f.enabled;
      setOriginal(newOriginal);
      invalidateFeatureFlags();
      setFeedback({ type: 'success', message: `Updated ${changed.length} feature flag${changed.length > 1 ? 's' : ''}` });
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="max-w-4xl mx-auto">
      <AdminNav />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Settings size={20} />
            Platform Settings
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Manage feature flags that control platform capabilities for all users.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          loading={saving}
          disabled={!hasChanges || saving}
        >
          Save Changes
        </Button>
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg mb-4 ${
          feedback.type === 'success'
            ? 'bg-emerald-500/10 text-emerald-500'
            : 'bg-destructive/10 text-destructive'
        }`}>
          {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span className="text-sm">{feedback.message}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : flags.length === 0 ? (
        <div className="text-center py-8 bg-muted/50 rounded-lg">
          <Settings className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-sm font-medium mb-1">No feature flags</h3>
          <p className="text-[13px] text-muted-foreground">
            Feature flags will appear here once they are configured in the database.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map(flag => (
            <div
              key={flag.key}
              className="flex items-center justify-between p-4 bg-card border border-border rounded-lg"
            >
              <div className="flex-1 mr-4">
                <p className="text-sm font-medium">{humanizeKey(flag.key)}</p>
                {flag.description && (
                  <p className="text-[13px] text-muted-foreground mt-0.5">{flag.description}</p>
                )}
                <p className="text-[11px] text-muted-foreground/60 mt-1 font-mono">{flag.key}</p>
              </div>
              <Toggle
                checked={flag.enabled}
                onChange={(checked) => handleToggle(flag.key, checked)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

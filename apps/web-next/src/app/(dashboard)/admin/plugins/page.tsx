'use client';

/**
 * Admin Plugin Configuration Page
 *
 * Allows system admins to designate which plugins are "core" —
 * core plugins are auto-installed for all users and cannot be uninstalled.
 * Users can still hide (disable) them, but they remain installed.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as LucideIcons from 'lucide-react';
import {
  Blocks,
  Shield,
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Star,
  StarOff,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { AdminNav } from '@/components/admin/AdminNav';

/** Resolve a Lucide icon name (e.g. "ShoppingBag") to a React component, with fallback. */
function getPluginIcon(iconName?: string | null): React.ReactNode {
  if (!iconName) return <Blocks size={18} />;
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[iconName];
  return Icon ? <Icon size={18} /> : <Blocks size={18} />;
}

interface PluginEntry {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
  icon: string | null;
  isCore: boolean;
}

export default function AdminPluginsPage() {
  const router = useRouter();
  const { hasRole } = useAuth();
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingChanges, setPendingChanges] = useState(false);

  const isAdmin = hasRole('system:admin');

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
      return;
    }
    loadPlugins();
  }, [isAdmin]);

  const loadPlugins = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/admin/plugins/core', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setPlugins(data.data.plugins || []);
      } else {
        setError(data.error?.message || 'Failed to load plugins');
      }
    } catch {
      setError('Failed to load plugins');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleCore = (pluginName: string) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.name === pluginName ? { ...p, isCore: !p.isCore } : p
      )
    );
    setPendingChanges(true);
    setSuccessMsg(null);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMsg(null);

      const corePluginNames = plugins.filter((p) => p.isCore).map((p) => p.name);

      const res = await fetch('/api/v1/admin/plugins/core', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ corePluginNames }),
      });

      const data = await res.json();
      if (data.success) {
        setPlugins(data.data.plugins || []);
        setPendingChanges(false);
        setSuccessMsg(data.data.message || 'Core plugins updated successfully.');
        setTimeout(() => setSuccessMsg(null), 5000);
      } else {
        setError(data.error?.message || 'Failed to save');
      }
    } catch {
      setError('Failed to save core plugin changes');
    } finally {
      setSaving(false);
    }
  };

  const coreCount = plugins.filter((p) => p.isCore).length;

  const filteredPlugins = plugins.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.displayName.toLowerCase().includes(q) ||
      (p.description?.toLowerCase().includes(q) ?? false) ||
      p.category.toLowerCase().includes(q)
    );
  });

  const corePlugins = filteredPlugins.filter((p) => p.isCore);
  const nonCorePlugins = filteredPlugins.filter((p) => !p.isCore);

  if (!isAdmin) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <AdminNav />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Blocks className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Plugin Configuration</h1>
            <p className="text-sm text-muted-foreground">
              Designate core plugins that are auto-installed and cannot be uninstalled by users.
            </p>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={!pendingChanges || saving}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            pendingChanges
              ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          }`}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Status messages */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 text-emerald-500 text-sm">
          <CheckCircle2 size={16} />
          {successMsg}
        </div>
      )}

      {/* Info banner */}
      <div className="p-4 rounded-xl bg-muted/50 border border-border/50">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-primary mt-0.5 flex-shrink-0" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How core plugins work</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Core plugins are automatically installed for all users</li>
              <li>Users <strong>cannot uninstall</strong> core plugins, but can hide them</li>
              <li>When you add a new core plugin, it is auto-installed for all existing users</li>
              <li>Currently <strong>{coreCount}</strong> plugin{coreCount !== 1 ? 's' : ''} marked as core</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search plugins..."
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
        />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 size={32} className="animate-spin text-primary mb-3" />
          <p className="text-sm text-muted-foreground">Loading plugins...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Core plugins section */}
          {corePlugins.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Star size={14} className="text-amber-500" />
                Core Plugins ({corePlugins.length})
              </h2>
              <div className="grid gap-2">
                {corePlugins.map((plugin) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    onToggle={toggleCore}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Available plugins section */}
          {nonCorePlugins.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Blocks size={14} />
                Available Plugins ({nonCorePlugins.length})
              </h2>
              <div className="grid gap-2">
                {nonCorePlugins.map((plugin) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    onToggle={toggleCore}
                  />
                ))}
              </div>
            </section>
          )}

          {filteredPlugins.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Blocks size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {searchQuery ? 'No plugins match your search' : 'No plugins found'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PluginRow({
  plugin,
  onToggle,
}: {
  plugin: PluginEntry;
  onToggle: (name: string) => void;
}) {
  const categoryColors: Record<string, string> = {
    platform: 'bg-purple-500/10 text-purple-500',
    monitoring: 'bg-blue-500/10 text-blue-500',
    analytics: 'bg-green-500/10 text-green-500',
    developer: 'bg-orange-500/10 text-orange-500',
    finance: 'bg-yellow-500/10 text-yellow-500',
    social: 'bg-pink-500/10 text-pink-500',
    media: 'bg-red-500/10 text-red-500',
  };

  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
        plugin.isCore
          ? 'bg-primary/5 border-primary/20'
          : 'bg-card border-border hover:border-border/80'
      }`}
    >
      {/* Icon */}
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
        {getPluginIcon(plugin.icon)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{plugin.displayName}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${categoryColors[plugin.category] || 'bg-muted text-muted-foreground'}`}>
            {plugin.category}
          </span>
          {plugin.isCore && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-500">
              CORE
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {plugin.description || plugin.name}
        </p>
      </div>

      {/* Toggle */}
      <button
        onClick={() => onToggle(plugin.name)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
          plugin.isCore
            ? 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
            : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
        }`}
      >
        {plugin.isCore ? (
          <>
            <StarOff size={14} />
            Remove Core
          </>
        ) : (
          <>
            <Star size={14} />
            Make Core
          </>
        )}
      </button>
    </div>
  );
}

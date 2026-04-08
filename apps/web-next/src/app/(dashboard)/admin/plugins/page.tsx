'use client';

/**
 * Admin Plugin & Template Configuration Page
 *
 * Allows system admins to:
 * - Designate which plugins are "core" (auto-installed, cannot be uninstalled)
 * - Control plugin visibility for non-admin users (sidebar + marketplace)
 * - Control gateway template visibility for non-admin users (connector wizard)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as LucideIcons from 'lucide-react';
import {
  Blocks,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Star,
  StarOff,
  Eye,
  EyeOff,
  Network,
} from 'lucide-react';
import { Button, Input, Badge, Tabs, Textarea, type Tab } from '@naap/ui';
import { useAuth } from '@/contexts/auth-context';
import { AdminNav } from '@/components/admin/AdminNav';
import { Search } from 'lucide-react';

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
  visibleToUsers: boolean;
  previewTesterUserIds: string[];
}

interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  visibleToUsers: boolean;
}

type AdminTab = 'plugins' | 'templates';

const adminTabs: Tab<AdminTab>[] = [
  { id: 'plugins', label: 'Plugins', icon: Blocks },
  { id: 'templates', label: 'Templates', icon: Network },
];

export default function AdminPluginsPage() {
  const router = useRouter();
  const { hasRole } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('plugins');

  const isAdmin = hasRole('system:admin');

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, router]);

  if (!isAdmin) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <AdminNav />

      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-muted">
          <Shield className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Launch Experience</h1>
          <p className="text-sm text-muted-foreground">
            Configure which plugins and templates are visible to users.
          </p>
        </div>
      </div>

      <Tabs tabs={adminTabs} activeTab={activeTab} onChange={setActiveTab}>
        {activeTab === 'plugins' && <PluginsTab />}
        {activeTab === 'templates' && <TemplatesTab />}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugins Tab
// ---------------------------------------------------------------------------

function PluginsTab() {
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingChanges, setPendingChanges] = useState(false);

  const loadPlugins = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/admin/plugins/core', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        const raw = data.data.plugins || [];
        setPlugins(
          raw.map((p: PluginEntry & { previewTesterUserIds?: string[] }) => ({
            ...p,
            previewTesterUserIds: Array.isArray(p.previewTesterUserIds)
              ? p.previewTesterUserIds
              : [],
          }))
        );
      } else {
        setError(data.error?.message || 'Failed to load plugins');
      }
    } catch {
      setError('Failed to load plugins');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  const toggleCore = (pluginName: string) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.name === pluginName ? { ...p, isCore: !p.isCore } : p
      )
    );
    setPendingChanges(true);
    setSuccessMsg(null);
  };

  const toggleVisibility = (pluginName: string) => {
    setPlugins((prev) =>
      prev.map((p) => {
        if (p.name !== pluginName) return p;
        const nextVisible = !p.visibleToUsers;
        return {
          ...p,
          visibleToUsers: nextVisible,
          previewTesterUserIds: nextVisible ? [] : p.previewTesterUserIds,
        };
      })
    );
    setPendingChanges(true);
    setSuccessMsg(null);
  };

  const setPreviewTesterIds = (pluginName: string, value: string) => {
    const ids = value
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setPlugins((prev) =>
      prev.map((p) =>
        p.name === pluginName ? { ...p, previewTesterUserIds: ids } : p
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
      const hiddenPluginNames = plugins.filter((p) => !p.visibleToUsers).map((p) => p.name);

      const previewTesterUserIdsByPlugin = Object.fromEntries(
        plugins.map((p) => [p.name, p.previewTesterUserIds || []])
      );

      const res = await fetch('/api/v1/admin/plugins/core', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          corePluginNames,
          hiddenPluginNames,
          previewTesterUserIdsByPlugin,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setPlugins(data.data.plugins || []);
        setPendingChanges(false);
        setSuccessMsg(data.data.message || 'Plugin configuration updated.');
        setTimeout(() => setSuccessMsg(null), 5000);
      } else {
        setError(data.error?.message || 'Failed to save');
      }
    } catch {
      setError('Failed to save plugin changes');
    } finally {
      setSaving(false);
    }
  };

  const coreCount = plugins.filter((p) => p.isCore).length;
  const hiddenCount = plugins.filter((p) => !p.visibleToUsers).length;

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

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          <strong>{coreCount}</strong> core &middot; <strong>{hiddenCount}</strong> hidden
        </div>
        <Button
          variant={pendingChanges ? 'primary' : 'secondary'}
          onClick={handleSave}
          disabled={!pendingChanges || saving}
          loading={saving}
          icon={!saving ? <Shield size={16} /> : undefined}
        >
          Save Changes
        </Button>
      </div>

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

      <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Plugin visibility & core settings</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li><strong>Core</strong> plugins are auto-installed for all users and cannot be uninstalled</li>
              <li><strong>Hidden</strong> plugins are not shown in the sidebar or marketplace for non-admin users</li>
              <li>
                <strong>Preview testers</strong> (user IDs below, when hidden): selected users still see the plugin and get
                it pre-installed like core
              </li>
              <li>Admin users always see all published plugins regardless of visibility</li>
            </ul>
          </div>
        </div>
      </div>

      <Input
        icon={<Search size={16} />}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search plugins..."
      />

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin text-muted-foreground border-2 border-current border-t-transparent rounded-full mb-3" />
          <p className="text-sm text-muted-foreground">Loading plugins...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {corePlugins.length > 0 && (
            <section>
              <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Star size={14} className="text-amber-500" />
                Core Plugins ({corePlugins.length})
              </h2>
              <div className="grid gap-2">
                {corePlugins.map((plugin) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    onToggleCore={toggleCore}
                    onToggleVisibility={toggleVisibility}
                    onPreviewIdsChange={setPreviewTesterIds}
                  />
                ))}
              </div>
            </section>
          )}

          {nonCorePlugins.length > 0 && (
            <section>
              <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Blocks size={14} />
                Available Plugins ({nonCorePlugins.length})
              </h2>
              <div className="grid gap-2">
                {nonCorePlugins.map((plugin) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    onToggleCore={toggleCore}
                    onToggleVisibility={toggleVisibility}
                    onPreviewIdsChange={setPreviewTesterIds}
                  />
                ))}
              </div>
            </section>
          )}

          {filteredPlugins.length === 0 && !loading && (
            <div className="text-center py-8 text-muted-foreground">
              <Blocks size={32} className="mx-auto mb-3 opacity-30" />
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
  onToggleCore,
  onToggleVisibility,
  onPreviewIdsChange,
}: {
  plugin: PluginEntry;
  onToggleCore: (name: string) => void;
  onToggleVisibility: (name: string) => void;
  onPreviewIdsChange: (name: string, raw: string) => void;
}) {
  const getCategoryBadgeVariant = (category: string): 'secondary' | 'blue' | 'emerald' | 'amber' | 'rose' => {
    const map: Record<string, 'secondary' | 'blue' | 'emerald' | 'amber' | 'rose'> = {
      platform: 'secondary',
      monitoring: 'blue',
      analytics: 'emerald',
      developer: 'amber',
      finance: 'amber',
      social: 'rose',
      media: 'rose',
    };
    return map[category] || 'secondary';
  };

  return (
    <div
      className={`flex flex-col rounded-lg border transition-all ${
        plugin.isCore
          ? 'bg-primary/5 border-primary/20'
          : 'bg-card border-border hover:border-border/80'
      } ${!plugin.visibleToUsers ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3 p-4">
      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
        {getPluginIcon(plugin.icon)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground">{plugin.displayName}</span>
          <Badge variant={getCategoryBadgeVariant(plugin.category)}>
            {plugin.category}
          </Badge>
          {plugin.isCore && <Badge variant="amber">CORE</Badge>}
          {!plugin.visibleToUsers && <Badge variant="secondary">HIDDEN</Badge>}
          {!plugin.visibleToUsers && plugin.previewTesterUserIds.length > 0 && (
            <Badge variant="blue">PREVIEW</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {plugin.description || plugin.name}
        </p>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => onToggleVisibility(plugin.name)}
          className={`p-1.5 rounded-md transition-colors ${
            plugin.visibleToUsers
              ? 'text-muted-foreground hover:bg-muted/50'
              : 'text-amber-500 hover:bg-amber-500/10'
          }`}
          title={plugin.visibleToUsers ? 'Hide from non-admin users' : 'Show to all users'}
          aria-label={`Toggle visibility for ${plugin.displayName}`}
        >
          {plugin.visibleToUsers ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>

        <Button
          variant={plugin.isCore ? 'ghost' : 'secondary'}
          size="sm"
          onClick={() => onToggleCore(plugin.name)}
          icon={plugin.isCore ? <StarOff size={14} /> : <Star size={14} />}
          className={plugin.isCore ? 'text-amber-500 hover:bg-amber-500/10' : ''}
        >
          {plugin.isCore ? 'Remove Core' : 'Make Core'}
        </Button>
      </div>
      </div>
      {!plugin.visibleToUsers && (
        <div className="px-4 pb-4 pt-0 border-t border-border/60 mt-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
            Preview tester user IDs (comma or newline separated)
          </label>
          <Textarea
            value={plugin.previewTesterUserIds.join('\n')}
            onChange={(e) => onPreviewIdsChange(plugin.name, e.target.value)}
            placeholder="e.g. clxxxxxxxx user uuid"
            rows={3}
            className="text-xs font-mono"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates Tab
// ---------------------------------------------------------------------------

function TemplatesTab() {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingChanges, setPendingChanges] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/admin/templates', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setTemplates(data.data.templates || []);
      } else {
        setError(data.error?.message || 'Failed to load templates');
      }
    } catch {
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const toggleVisibility = (templateId: string) => {
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === templateId ? { ...t, visibleToUsers: !t.visibleToUsers } : t
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

      const hiddenTemplateIds = templates.filter((t) => !t.visibleToUsers).map((t) => t.id);

      const res = await fetch('/api/v1/admin/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hiddenTemplateIds }),
      });

      const data = await res.json();
      if (data.success) {
        setTemplates(data.data.templates || []);
        setPendingChanges(false);
        setSuccessMsg(data.data.message || 'Template visibility updated.');
        setTimeout(() => setSuccessMsg(null), 5000);
      } else {
        setError(data.error?.message || 'Failed to save');
      }
    } catch {
      setError('Failed to save template changes');
    } finally {
      setSaving(false);
    }
  };

  const hiddenCount = templates.filter((t) => !t.visibleToUsers).length;

  const filteredTemplates = templates.filter((t) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          <strong>{templates.length}</strong> total &middot; <strong>{hiddenCount}</strong> hidden
        </div>
        <Button
          variant={pendingChanges ? 'primary' : 'secondary'}
          onClick={handleSave}
          disabled={!pendingChanges || saving}
          loading={saving}
          icon={!saving ? <Shield size={16} /> : undefined}
        >
          Save Changes
        </Button>
      </div>

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

      <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
        <div className="flex items-start gap-3">
          <Network size={18} className="text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Gateway template visibility</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Hidden templates are not shown in the connector creation wizard for non-admin users</li>
              <li>Admin users always see all templates</li>
            </ul>
          </div>
        </div>
      </div>

      <Input
        icon={<Search size={16} />}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search templates..."
      />

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin text-muted-foreground border-2 border-current border-t-transparent rounded-full mb-3" />
          <p className="text-sm text-muted-foreground">Loading templates...</p>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Network size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {searchQuery ? 'No templates match your search' : 'No gateway templates found'}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {filteredTemplates.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              onToggleVisibility={toggleVisibility}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateRow({
  template,
  onToggleVisibility,
}: {
  template: TemplateEntry;
  onToggleVisibility: (id: string) => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-4 rounded-lg border bg-card border-border hover:border-border/80 transition-all ${
        !template.visibleToUsers ? 'opacity-60' : ''
      }`}
    >
      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
        {getPluginIcon(template.icon)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground">{template.name}</span>
          {template.category && (
            <Badge variant="secondary">{template.category}</Badge>
          )}
          {!template.visibleToUsers && <Badge variant="secondary">HIDDEN</Badge>}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {template.description}
        </p>
      </div>

      <button
        onClick={() => onToggleVisibility(template.id)}
        className={`p-1.5 rounded-md transition-colors flex-shrink-0 ${
          template.visibleToUsers
            ? 'text-muted-foreground hover:bg-muted/50'
            : 'text-amber-500 hover:bg-amber-500/10'
        }`}
        title={template.visibleToUsers ? 'Hide from non-admin users' : 'Show to all users'}
        aria-label={`Toggle visibility for ${template.name}`}
      >
        {template.visibleToUsers ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>
    </div>
  );
}

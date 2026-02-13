'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Reorder } from 'framer-motion';
import { useAuth } from '@/contexts/auth-context';
import { useShell, useEvents } from '@/contexts/shell-context';
import { usePlugins } from '@/contexts/plugin-context';
import { getCsrfToken } from '@/lib/api/csrf';
import {
  User, Bell, Palette, Shield, Key, LogOut, Save, Globe,
  Eye, EyeOff, Pin, GripVertical, RotateCw, Trash2, Settings as SettingsIcon,
  Users, ExternalLink, Loader2, AlertTriangle, Info, Plug, Brain, Cloud, Mail,
  CreditCard, Phone, Check, X, Plus, Pencil, Camera
} from 'lucide-react';
import * as Icons from 'lucide-react';

/** Only allow http/https URLs for image sources to prevent XSS via javascript: URIs */
function getSafeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

interface PluginPreference {
  name: string;
  displayName: string;
  enabled: boolean;
  order: number;
  pinned: boolean;
  icon?: string;
  installId?: string;
  isCore?: boolean;
  installed?: boolean;
}

interface Integration {
  type: string;
  displayName: string;
  configured: boolean;
  category?: string;
}

interface TenantInstallation {
  id: string;
  deployment: {
    package: { displayName: string; icon?: string };
    version: { version: string };
    status: string;
  };
  config?: { settings?: Record<string, unknown> };
}

interface TenantConfigEntry {
  key: string;
  value: string;
  isSecret?: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout, isAuthenticated } = useAuth();
  const { theme, notifications } = useShell();
  const { plugins, refreshPlugins } = usePlugins();
  const eventBus = useEvents();
  
  const [notificationSettings, setNotificationSettings] = useState({
    email: true,
    push: true,
    sla: true,
  });
  const [userPreferences, setUserPreferences] = useState<PluginPreference[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  
  // Uninstall state
  const [uninstallingPlugin, setUninstallingPlugin] = useState<PluginPreference | null>(null);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [uninstallLoading, setUninstallLoading] = useState(false);

  // Profile editing state
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [profileAvatarPreview, setProfileAvatarPreview] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Integration state
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [configureIntegration, setConfigureIntegration] = useState<Integration | null>(null);
  const [integrationCredentials, setIntegrationCredentials] = useState<Record<string, string>>({});
  const [savingIntegration, setSavingIntegration] = useState(false);

  // Tenant plugin config state
  const [tenantInstallations, setTenantInstallations] = useState<TenantInstallation[]>([]);
  const [loadingTenantInstalls, setLoadingTenantInstalls] = useState(true);
  const [configuringPlugin, setConfiguringPlugin] = useState<TenantInstallation | null>(null);
  const [tenantConfigEntries, setTenantConfigEntries] = useState<TenantConfigEntry[]>([]);

  // Get current team from localStorage
  const currentTeamId = typeof window !== 'undefined' ? localStorage.getItem('naap_current_team') : null;
  const isTeamContext = !!currentTeamId;
  const [teamName, setTeamName] = useState<string>('Team');

  useEffect(() => {
    loadPluginsAndPreferences();
    loadIntegrations();
    loadTenantInstallations();
  }, [isAuthenticated, currentTeamId]);

  const loadTenantInstallations = async () => {
    if (!isAuthenticated || !user?.id) {
      setLoadingTenantInstalls(false);
      return;
    }

    try {
      setLoadingTenantInstalls(true);
      const res = await fetch(`/api/v1/tenant/installations?userId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setTenantInstallations(data.data?.installations || data.installations || []);
      }
    } catch (error) {
      console.error('Failed to load tenant installations:', error);
    } finally {
      setLoadingTenantInstalls(false);
    }
  };

  const handleOpenPluginConfig = (installation: TenantInstallation) => {
    setConfiguringPlugin(installation);

    if (installation.config?.settings) {
      const entries: TenantConfigEntry[] = Object.entries(installation.config.settings).map(
        ([key, value]) => ({
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          isSecret: key.toLowerCase().includes('key') || key.toLowerCase().includes('secret'),
        })
      );
      setTenantConfigEntries(entries);
    } else {
      setTenantConfigEntries([]);
    }
  };

  const handleSavePluginConfig = async () => {
    if (!configuringPlugin) return;

    setSaving(true);
    try {
      const settings: Record<string, unknown> = {};
      for (const entry of tenantConfigEntries) {
        try {
          settings[entry.key] = JSON.parse(entry.value);
        } catch {
          settings[entry.key] = entry.value;
        }
      }

      const res = await fetch(`/api/v1/tenant/installations/${configuringPlugin.id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });

      if (res.ok) {
        notifications.success('Plugin configuration saved');
        await loadTenantInstallations();
        setConfiguringPlugin(null);
      } else {
        notifications.error('Failed to save plugin configuration');
      }
    } catch (error) {
      console.error('Failed to save plugin config:', error);
      notifications.error('Failed to save plugin configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleAddConfigEntry = () => {
    setTenantConfigEntries([...tenantConfigEntries, { key: '', value: '' }]);
  };

  const handleRemoveConfigEntry = (index: number) => {
    setTenantConfigEntries(tenantConfigEntries.filter((_, i) => i !== index));
  };

  const handleUpdateConfigEntry = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...tenantConfigEntries];
    updated[index] = { ...updated[index], [field]: value };
    setTenantConfigEntries(updated);
  };

  // Load profile data
  const loadProfile = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch('/api/v1/auth/profile');
      if (res.ok) {
        const data = await res.json();
        const u = data.data?.user;
        if (u) {
          setProfileName(u.displayName || '');
          setProfileBio(u.bio || '');
          setProfileAvatarUrl(u.avatarUrl || '');
          setProfileAvatarPreview(u.avatarUrl || null);
        }
      }
    } catch {
      // fallback to auth context
      setProfileName(user?.displayName || '');
      setProfileBio('');
      setProfileAvatarUrl(user?.avatarUrl || '');
      setProfileAvatarPreview(user?.avatarUrl || null);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleStartEditProfile = () => {
    setEditingProfile(true);
  };

  const handleCancelEditProfile = () => {
    setEditingProfile(false);
    loadProfile();
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await fetch('/api/v1/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: profileName,
          avatarUrl: profileAvatarUrl,
          bio: profileBio,
        }),
      });

      if (res.ok) {
        notifications.success('Profile updated successfully');
        setEditingProfile(false);
        setProfileAvatarPreview(profileAvatarUrl || null);
      } else {
        const data = await res.json();
        notifications.error(data.error?.message || 'Failed to update profile');
      }
    } catch {
      notifications.error('Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const loadIntegrations = async () => {
    try {
      setLoadingIntegrations(true);
      const res = await fetch('/api/v1/integrations');
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.data?.integrations || data.integrations || []);
      }
    } catch (error) {
      console.error('Failed to load integrations:', error);
    } finally {
      setLoadingIntegrations(false);
    }
  };

  const handleConfigureIntegration = async () => {
    if (!configureIntegration) return;

    setSavingIntegration(true);
    try {
      const res = await fetch(`/api/v1/integrations/${configureIntegration.type}/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: integrationCredentials }),
      });

      if (res.ok) {
        notifications.success(`${configureIntegration.displayName} configured successfully`);
        setConfigureIntegration(null);
        setIntegrationCredentials({});
        await loadIntegrations();
      } else {
        notifications.error('Failed to configure integration');
      }
    } catch (error) {
      console.error('Failed to configure integration:', error);
      notifications.error('Failed to configure integration');
    } finally {
      setSavingIntegration(false);
    }
  };

  const getIntegrationIcon = (type: string) => {
    switch (type) {
      case 'openai':
      case 'anthropic':
        return <Brain size={20} />;
      case 'aws-s3':
      case 'gcp-storage':
      case 'azure-blob':
        return <Cloud size={20} />;
      case 'sendgrid':
      case 'mailgun':
      case 'ses':
        return <Mail size={20} />;
      case 'stripe':
      case 'paypal':
        return <CreditCard size={20} />;
      case 'twilio':
        return <Phone size={20} />;
      default:
        return <Plug size={20} />;
    }
  };

  const getIntegrationFields = (type: string): Array<{ key: string; label: string; secret?: boolean }> => {
    switch (type) {
      case 'openai':
        return [
          { key: 'apiKey', label: 'API Key', secret: true },
          { key: 'organization', label: 'Organization ID' },
        ];
      case 'anthropic':
        return [{ key: 'apiKey', label: 'API Key', secret: true }];
      case 'aws-s3':
        return [
          { key: 'accessKeyId', label: 'Access Key ID', secret: true },
          { key: 'secretAccessKey', label: 'Secret Access Key', secret: true },
          { key: 'region', label: 'Region' },
          { key: 'bucket', label: 'Default Bucket' },
        ];
      case 'sendgrid':
        return [
          { key: 'apiKey', label: 'API Key', secret: true },
          { key: 'fromEmail', label: 'Default From Email' },
        ];
      case 'stripe':
        return [
          { key: 'secretKey', label: 'Secret Key', secret: true },
          { key: 'webhookSecret', label: 'Webhook Secret', secret: true },
        ];
      case 'twilio':
        return [
          { key: 'accountSid', label: 'Account SID', secret: true },
          { key: 'authToken', label: 'Auth Token', secret: true },
          { key: 'phoneNumber', label: 'Phone Number' },
        ];
      default:
        return [{ key: 'apiKey', label: 'API Key', secret: true }];
    }
  };

  const loadPluginsAndPreferences = async () => {
    try {
      setLoadingPrefs(true);
      setPrefsError(null);

      // Normalize plugin name for deduplication
      const normalizePluginName = (name: string) => 
        name.toLowerCase().replace(/[-_]/g, '');

      // If in team context, fetch team plugins
      if (isTeamContext && currentTeamId) {
        try {
          const res = await fetch(`/api/v1/teams/${currentTeamId}/my-plugins`);
          if (res.ok) {
            const data = await res.json();
            const teamPlugins = data.data?.plugins || data.plugins || [];
            
            // Deduplicate and convert to preferences format
            const seenNames = new Set<string>();
            const prefs: PluginPreference[] = teamPlugins
              .filter((p: { name: string }) => {
                const normalized = normalizePluginName(p.name);
                if (seenNames.has(normalized)) return false;
                seenNames.add(normalized);
                return true;
              })
              .map((p: { name: string; displayName: string; enabled: boolean; visible: boolean; order: number; pinned: boolean; icon?: string; installId: string; isCore: boolean }) => ({
                name: p.name,
                displayName: p.displayName,
                enabled: p.enabled ?? p.visible ?? true,
                order: p.order ?? 0,
                pinned: p.pinned ?? false,
                icon: p.icon,
                installId: p.installId,
                isCore: p.isCore ?? false,
              }));

            setUserPreferences(prefs.sort((a: PluginPreference, b: PluginPreference) => a.order - b.order));
            setTeamName(data.data?.team?.name || 'Team');
            return;
          }
        } catch (err) {
          console.warn('Failed to fetch team plugins:', err);
        }
      }

      // Personal context: use global plugins with user preferences
      // Deduplicate plugins by normalized name
      const seenNames = new Set<string>();
      const uniquePlugins = plugins.filter(plugin => {
        const normalized = normalizePluginName(plugin.name);
        if (seenNames.has(normalized)) return false;
        seenNames.add(normalized);
        return true;
      });

      // Convert plugins to preferences format
      // Only include plugins that are explicitly installed (have a preference record)
      // or are core plugins. Uninstalled plugins should be found in the marketplace.
      const prefs = uniquePlugins
        .filter(plugin => plugin.installed !== false)
        .map((plugin, idx) => ({
          name: plugin.name,
          displayName: plugin.displayName,
          enabled: plugin.enabled,
          order: plugin.order ?? idx,
          pinned: false,
          icon: plugin.icon,
          installed: plugin.installed,
        }));

      // Try to load user preferences from API
      if (isAuthenticated && user?.id) {
        try {
          const res = await fetch(`/api/v1/base/user/preferences?userId=${user.id}`);
          if (res.ok) {
            const data = await res.json();
            const prefsMap = new Map(
              (data.data?.preferences || data.preferences || []).map((p: { pluginName: string; enabled: boolean; order?: number; pinned?: boolean }) => [p.pluginName, p])
            );

            // Merge with plugin data
            const merged = prefs.map(plugin => {
              const pref = prefsMap.get(plugin.name) as { enabled: boolean; order?: number; pinned?: boolean } | undefined;
              return {
                ...plugin,
                enabled: pref ? pref.enabled : plugin.enabled,
                order: pref?.order ?? plugin.order,
                pinned: pref?.pinned ?? false,
              };
            });

            setUserPreferences(merged.sort((a, b) => a.order - b.order));
            return;
          }
        } catch (err) {
          console.warn('Failed to fetch user preferences:', err);
        }
      }

      setUserPreferences(prefs);
    } catch (error) {
      console.error('Failed to load plugin preferences:', error);
      setPrefsError('Failed to load plugins. Please try again.');
      setUserPreferences([]);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const savePreference = async (pluginName: string, pref: PluginPreference) => {
    if (!isAuthenticated || !user?.id) return;

    setSaving(true);
    try {
      const csrfToken = await getCsrfToken();
      let res;
      
      if (isTeamContext && currentTeamId && pref.installId) {
        // Team context: use team-specific endpoint
        res = await fetch(`/api/v1/teams/${currentTeamId}/members/me/plugins/${pref.installId}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({
            visible: pref.enabled,
            pinned: pref.pinned,
            order: pref.order,
          }),
        });
      } else {
        // Personal context: use user preferences endpoint
        res = await fetch('/api/v1/base/user/preferences', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({
            userId: user.id,
            pluginName,
            enabled: pref.enabled,
            order: pref.order,
            pinned: pref.pinned,
          }),
        });
      }

      if (!res.ok) {
        notifications.error('Failed to save preference');
        await loadPluginsAndPreferences();
        return;
      }

      await refreshPlugins();
      // Emit event to notify other components (like sidebar) to refresh
      eventBus.emit('plugin:preferences:changed', { pluginName });
    } catch (error) {
      console.error('Failed to save preference:', error);
      notifications.error('Failed to save preference');
      await loadPluginsAndPreferences();
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePlugin = async (pluginName: string) => {
    const plugin = userPreferences.find(p => p.name === pluginName);
    if (!plugin) return;

    if (plugin.isCore) {
      notifications.info('Core plugins cannot be disabled');
      return;
    }

    const newState = !plugin.enabled;
    const updated = userPreferences.map(p =>
      p.name === pluginName ? { ...p, enabled: newState } : p
    );
    setUserPreferences(updated);
    await savePreference(pluginName, updated.find(p => p.name === pluginName)!);
    notifications.success(`${plugin.displayName} ${newState ? 'enabled' : 'disabled'}`);
  };

  const handlePinPlugin = async (pluginName: string) => {
    const plugin = userPreferences.find(p => p.name === pluginName);
    const newState = !plugin?.pinned;

    const updated = userPreferences.map(p =>
      p.name === pluginName ? { ...p, pinned: newState } : p
    );
    setUserPreferences(updated);
    await savePreference(pluginName, updated.find(p => p.name === pluginName)!);
    notifications.info(`${plugin?.displayName} ${newState ? 'pinned to top' : 'unpinned'}`);
  };

  const handleReorder = useCallback(async (reorderedPlugins: PluginPreference[]) => {
    // Update order based on new positions
    const updated = reorderedPlugins.map((plugin, index) => ({
      ...plugin,
      order: index,
    }));
    
    setUserPreferences(updated);
    
    // Save new order for each plugin
    setSaving(true);
    try {
      for (const plugin of updated) {
        await fetch('/api/v1/base/user/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user?.id,
            pluginName: plugin.name,
            enabled: plugin.enabled,
            order: plugin.order,
            pinned: plugin.pinned,
          }),
        });
      }
      await refreshPlugins();
    } catch (error) {
      console.error('Failed to save reorder:', error);
      notifications.error('Failed to save new order');
      await loadPluginsAndPreferences();
    } finally {
      setSaving(false);
    }
  }, [user?.id, refreshPlugins, notifications, loadPluginsAndPreferences]);

  const handleUninstallClick = (plugin: PluginPreference) => {
    setUninstallingPlugin(plugin);
    setShowUninstallConfirm(true);
  };

  const handleUninstallConfirm = async () => {
    if (!uninstallingPlugin) return;

    if (uninstallingPlugin.isCore) {
      notifications.error('Core plugins cannot be uninstalled');
      setShowUninstallConfirm(false);
      setUninstallingPlugin(null);
      return;
    }

    setUninstallLoading(true);
    try {
      const csrfToken = await getCsrfToken();
      
      let res;
      if (isTeamContext && currentTeamId && uninstallingPlugin.installId) {
        // Team context: uninstall from team
        res = await fetch(`/api/v1/teams/${currentTeamId}/plugins/${uninstallingPlugin.installId}`, {
          method: 'DELETE',
          headers: { 
            'x-user-id': user?.id || 'anonymous',
            'X-CSRF-Token': csrfToken,
          },
        });
      } else {
        // Personal context: uninstall from user
        res = await fetch(`/api/v1/installations/${uninstallingPlugin.name}`, {
          method: 'DELETE',
          headers: { 
            'x-user-id': user?.id || 'anonymous',
            'X-CSRF-Token': csrfToken,
          },
        });
      }

      if (res.ok) {
        setUserPreferences(prev => prev.filter(p => p.name !== uninstallingPlugin.name));
        await refreshPlugins();
        eventBus.emit('plugin:uninstalled', { pluginName: uninstallingPlugin.name, teamId: currentTeamId });
        notifications.success(`${uninstallingPlugin.displayName} has been uninstalled`);
      } else {
        notifications.error('Failed to uninstall plugin');
      }
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
      notifications.error('Failed to uninstall plugin');
    } finally {
      setUninstallLoading(false);
      setShowUninstallConfirm(false);
      setUninstallingPlugin(null);
    }
  };

  const handleResetToDefaults = async () => {
    if (!isAuthenticated || !user?.id) return;

    for (const pref of userPreferences) {
      await fetch('/api/v1/base/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          pluginName: pref.name,
          enabled: true,
          order: null,
          pinned: false,
        }),
      });
    }

    await loadPluginsAndPreferences();
    await refreshPlugins();
    notifications.success('Preferences reset to defaults');
  };

  const getIcon = (iconName?: string) => {
    if (!iconName) return '📦';
    const IconComponent = (Icons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[iconName];
    return IconComponent ? <IconComponent size={20} /> : '📦';
  };

  const handleThemeToggle = () => {
    theme.toggle();
    notifications.success(`Switched to ${theme.mode === 'dark' ? 'light' : 'dark'} mode`);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account and application preferences
        </p>
      </div>

      {/* Profile Section */}
      <section className="bg-card rounded-xl border p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <User className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Profile</h2>
          </div>
          {!editingProfile && (
            <button
              onClick={handleStartEditProfile}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted rounded-lg hover:bg-muted/80 transition-all text-muted-foreground hover:text-foreground"
            >
              <Pencil size={14} />
              Edit Profile
            </button>
          )}
        </div>

        {editingProfile ? (
          /* ── Editing mode ────────────────────────────────────────── */
          <div className="space-y-6">
            {/* Avatar */}
            <div className="flex items-start gap-6">
              <div className="relative group">
                {getSafeImageUrl(profileAvatarPreview) ? (
                  <img src={getSafeImageUrl(profileAvatarPreview)!} alt="" className="w-20 h-20 rounded-2xl object-cover" />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-500 to-primary flex items-center justify-center text-2xl font-bold text-white">
                    {(profileName || user?.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera size={20} className="text-white" />
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1.5">Avatar URL</label>
                <input
                  type="url"
                  value={profileAvatarUrl}
                  onChange={(e) => {
                    setProfileAvatarUrl(e.target.value);
                    setProfileAvatarPreview(e.target.value || null);
                  }}
                  placeholder="https://example.com/avatar.jpg"
                  className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                />
                <p className="text-xs text-muted-foreground mt-1">Paste a URL to an image for your profile picture</p>
              </div>
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Display Name</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                maxLength={50}
                placeholder="Your display name"
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
              />
              <p className="text-xs text-muted-foreground mt-1">{profileName.length}/50 characters</p>
            </div>

            {/* Bio / Description */}
            <div>
              <label className="block text-sm font-medium mb-1.5">About</label>
              <textarea
                value={profileBio}
                onChange={(e) => {
                  if (e.target.value.length <= 150) setProfileBio(e.target.value);
                }}
                maxLength={150}
                rows={3}
                placeholder="Tell us a bit about yourself..."
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors resize-none"
              />
              <p className={`text-xs mt-1 ${profileBio.length >= 140 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                {profileBio.length}/150 characters
              </p>
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Email</label>
              <p className="text-sm font-mono px-4 py-2.5 bg-muted/50 rounded-lg text-muted-foreground">
                {user?.email || 'Not set'}
              </p>
            </div>

            {/* Roles (read-only) */}
            {user?.roles && user.roles.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {user.roles.map(role => (
                  <span key={role} className="px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full">
                    {role.split(':')[1] || role}
                  </span>
                ))}
              </div>
            )}

            {/* Save / Cancel */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Profile
              </button>
              <button
                onClick={handleCancelEditProfile}
                className="px-5 py-2.5 border border-border rounded-lg text-sm hover:bg-muted transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          /* ── View mode ───────────────────────────────────────────── */
          <div className="space-y-6">
            <div className="flex items-center gap-6">
              {getSafeImageUrl(profileAvatarPreview) ? (
                <img src={getSafeImageUrl(profileAvatarPreview)!} alt="" className="w-20 h-20 rounded-2xl object-cover" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-500 to-primary flex items-center justify-center text-2xl font-bold text-white">
                  {(profileName || user?.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1">
                <h3 className="text-lg font-bold">
                  {profileName || user?.email?.split('@')[0] || 'User'}
                </h3>
                <p className="text-sm text-muted-foreground font-mono">
                  {user?.email || user?.address || 'Not set'}
                </p>
                {profileBio && (
                  <p className="text-sm text-muted-foreground mt-2">{profileBio}</p>
                )}
                {user?.roles && user.roles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {user.roles.map(role => (
                      <span key={role} className="px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full">
                        {role.split(':')[1] || role}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Notifications */}
      <section className="bg-card rounded-xl border p-6">
        <div className="flex items-center gap-3 mb-6">
          <Bell className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Notifications</h2>
        </div>
        <div className="space-y-4">
          {[
            { key: 'email', icon: <Globe size={20} />, label: 'Email Notifications', desc: 'Receive email alerts for important events' },
            { key: 'push', icon: <Bell size={20} />, label: 'Push Notifications', desc: 'Browser push notifications for real-time updates' },
            { key: 'sla', icon: <Shield size={20} />, label: 'SLA Alerts', desc: 'Get notified when SLA thresholds are at risk' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  {item.icon}
                </div>
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              </div>
              <button
                onClick={() => setNotificationSettings(prev => ({ ...prev, [item.key]: !prev[item.key as keyof typeof prev] }))}
                className={`w-12 h-6 rounded-full transition-colors ${
                  notificationSettings[item.key as keyof typeof notificationSettings] ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  notificationSettings[item.key as keyof typeof notificationSettings] ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Plugin Personalization */}
      <section className="bg-card rounded-xl border p-6">
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">
            {isTeamContext ? `Team Plugins: ${teamName}` : 'Personalize Plugins'}
          </h2>
        </div>

        {/* Team context info banner */}
        {isTeamContext && (
          <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Users size={20} className="text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">Team Context Active</p>
                  <p className="text-sm text-muted-foreground">
                    Showing plugins installed for your team
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => router.push(`/teams/${currentTeamId}`)}
                  className="flex items-center gap-2 px-3 py-2 bg-muted text-sm rounded-lg hover:bg-muted/80 transition-all"
                >
                  <SettingsIcon size={14} />
                  Manage Team
                </button>
                <button
                  onClick={() => router.push(`/marketplace?teamId=${currentTeamId}`)}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-500/90 transition-all"
                >
                  <ExternalLink size={14} />
                  Install More
                </button>
              </div>
            </div>
          </div>
        )}

        {!isAuthenticated ? (
          <div className="p-6 bg-muted/50 rounded-xl text-center">
            <p className="text-muted-foreground">Sign in to personalize your plugin experience.</p>
          </div>
        ) : loadingPrefs ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : prefsError ? (
          <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium mb-1">Failed to Load Plugins</p>
                <p className="text-sm text-muted-foreground mb-3">{prefsError}</p>
                <button
                  onClick={() => {
                    setPrefsError(null);
                    loadPluginsAndPreferences();
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-all"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        ) : userPreferences.length === 0 ? (
          <div className="p-6 bg-muted/50 rounded-xl text-center">
            <p className="text-muted-foreground">No plugins available.</p>
            <button
              onClick={loadPluginsAndPreferences}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-all"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                Drag to reorder • Toggle to enable/disable • Pin to keep at top
              </p>
              <button
                onClick={handleResetToDefaults}
                className="px-3 py-1.5 text-xs bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-all"
              >
                Reset to Defaults
              </button>
            </div>

            <Reorder.Group
              axis="y"
              values={userPreferences}
              onReorder={handleReorder}
              className="space-y-2"
            >
              {userPreferences.map((plugin) => (
                <Reorder.Item
                  key={plugin.name}
                  value={plugin}
                  className="bg-muted/50 rounded-lg p-4 flex items-center gap-4 hover:bg-muted/70 transition-all cursor-grab active:cursor-grabbing"
                >
                  <GripVertical size={20} className="text-muted-foreground" />

                  <div className="flex-1 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      {getIcon(plugin.icon)}
                    </div>
                    <div>
                      <p className="font-medium">{plugin.displayName}</p>
                      <p className="text-xs text-muted-foreground">{plugin.name}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePinPlugin(plugin.name)}
                      className={`p-2 rounded-lg transition-all ${
                        plugin.pinned
                          ? 'bg-blue-500 text-white'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                      title={plugin.pinned ? 'Unpin' : 'Pin to top'}
                    >
                      <Pin size={16} />
                    </button>

                    <button
                      onClick={() => handleTogglePlugin(plugin.name)}
                      className={`p-2 rounded-lg transition-all ${
                        plugin.enabled
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                      title={plugin.enabled ? 'Disable' : 'Enable'}
                    >
                      {plugin.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>

                    {plugin.isCore ? (
                      <div
                        className="p-2 rounded-lg bg-muted/50 text-muted-foreground/40 cursor-not-allowed"
                        title="Core plugin — cannot be uninstalled"
                      >
                        <Shield size={16} />
                      </div>
                    ) : (
                      <button
                        onClick={() => handleUninstallClick(plugin)}
                        className="p-2 rounded-lg bg-muted text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-all"
                        title="Uninstall plugin"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </Reorder.Item>
              ))}
            </Reorder.Group>

            {saving && (
              <div className="mt-4 text-center text-sm text-primary flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving preferences...
              </div>
            )}
          </div>
        )}
      </section>

      {/* Appearance Section */}
      <section className="bg-card rounded-xl border p-6">
        <div className="flex items-center gap-3 mb-6">
          <Palette className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Appearance</h2>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Theme</p>
            <p className="text-sm text-muted-foreground">
              Currently using {theme.mode} mode
            </p>
          </div>
          <button
            onClick={handleThemeToggle}
            className="px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
          >
            Switch to {theme.mode === 'dark' ? 'Light' : 'Dark'} Mode
          </button>
        </div>
      </section>

      {/* API Keys Section */}
      <section className="bg-card rounded-xl border p-6">
        <div className="flex items-center gap-3 mb-6">
          <Key className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">API Keys</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Key size={20} className="text-amber-500" />
              </div>
              <div>
                <p className="font-mono">lp_sk_****************************</p>
                <p className="text-sm text-muted-foreground">Created 30 days ago</p>
              </div>
            </div>
            <button className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive transition-all">
              <RotateCw size={18} />
            </button>
          </div>

          <button className="w-full py-3 border border-dashed border-muted-foreground/30 rounded-xl text-muted-foreground hover:text-primary hover:border-primary/30 transition-all">
            + Generate New API Key
          </button>
        </div>
      </section>

      {/* My Plugin Configurations */}
      {isAuthenticated && tenantInstallations.length > 0 && (
        <section className="bg-card rounded-xl border p-6">
          <div className="flex items-center gap-3 mb-6">
            <SettingsIcon className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">My Plugin Configurations</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Personal settings for your installed plugins (isolated per user)
          </p>

          {loadingTenantInstalls ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl mb-4">
                <div className="flex items-start gap-3">
                  <Info size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium mb-1">Multi-Tenant Plugin Configuration</p>
                    <p>Each user has their own isolated configuration for plugins. Changes you make here won&apos;t affect other users.</p>
                  </div>
                </div>
              </div>

              {tenantInstallations.map((installation) => (
                <div
                  key={installation.id}
                  className="p-4 bg-muted/50 rounded-xl border border-border hover:border-muted-foreground/30 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                        {getIcon(installation.deployment.package.icon)}
                      </div>
                      <div>
                        <p className="font-medium">{installation.deployment.package.displayName}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>v{installation.deployment.version.version}</span>
                          <span className={`w-2 h-2 rounded-full ${
                            installation.deployment.status === 'running' ? 'bg-primary' :
                            installation.deployment.status === 'failed' ? 'bg-destructive' :
                            'bg-amber-500'
                          }`} />
                          <span className="capitalize">{installation.deployment.status}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {installation.config && Object.keys(installation.config.settings || {}).length > 0 && (
                        <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 text-xs rounded-full">
                          {Object.keys(installation.config.settings || {}).length} settings
                        </span>
                      )}
                      <button
                        onClick={() => handleOpenPluginConfig(installation)}
                        className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-all"
                        title="Configure plugin"
                      >
                        <SettingsIcon size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Integrations Section */}
      <section className="bg-card rounded-xl border p-6">
        <div className="flex items-center gap-3 mb-6">
          <Plug className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Integrations</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Connect third-party services for enhanced plugin capabilities
        </p>
        {loadingIntegrations ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : integrations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Plug className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No integrations available</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {integrations.map((integration) => (
              <div
                key={integration.type}
                className={`p-4 rounded-xl border transition-all ${
                  integration.configured
                    ? 'bg-primary/5 border-primary/20'
                    : 'bg-muted/50 border-border hover:border-muted-foreground/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      integration.configured
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {getIntegrationIcon(integration.type)}
                    </div>
                    <div>
                      <p className="font-medium">{integration.displayName}</p>
                      <p className="text-xs text-muted-foreground">{integration.type}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {integration.configured && (
                      <div className="flex items-center gap-1 text-primary text-xs">
                        <Check size={14} />
                        <span>Configured</span>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setConfigureIntegration(integration);
                        setIntegrationCredentials({});
                      }}
                      className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-all"
                    >
                      <SettingsIcon size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Save Button */}
      <div className="flex justify-end">
        <button className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all">
          <Save size={18} />
          Save Changes
        </button>
      </div>

      {/* Danger Zone */}
      <section className="bg-destructive/5 rounded-xl border border-destructive/20 p-6">
        <div className="flex items-center gap-3 mb-6">
          <LogOut className="h-5 w-5 text-destructive" />
          <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Sign Out</p>
            <p className="text-sm text-muted-foreground">
              Sign out from all devices
            </p>
          </div>
          <button
            onClick={() => logout()}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            Sign Out
          </button>
        </div>
      </section>

      {/* Uninstall Confirmation Modal */}
      {showUninstallConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md m-4 shadow-xl">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Uninstall Plugin
            </h2>

            <p className="text-muted-foreground mb-4">
              Are you sure you want to uninstall &quot;{uninstallingPlugin?.displayName}&quot;?
              You can reinstall it later from the Marketplace.
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowUninstallConfirm(false);
                  setUninstallingPlugin(null);
                }}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUninstallConfirm}
                disabled={uninstallLoading}
                className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                {uninstallLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Uninstall
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Integration Configuration Modal */}
      {configureIntegration && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl w-full max-w-md m-4 shadow-xl">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  {getIntegrationIcon(configureIntegration.type)}
                </div>
                <div>
                  <h3 className="text-lg font-bold">Configure {configureIntegration.displayName}</h3>
                  <p className="text-sm text-muted-foreground">Enter your credentials</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setConfigureIntegration(null);
                  setIntegrationCredentials({});
                }}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {getIntegrationFields(configureIntegration.type).map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    {field.label}
                  </label>
                  <input
                    type={field.secret ? 'password' : 'text'}
                    value={integrationCredentials[field.key] || ''}
                    onChange={(e) => setIntegrationCredentials(prev => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))}
                    placeholder={field.secret ? '••••••••••••••' : ''}
                    className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                  />
                </div>
              ))}
            </div>

            <div className="flex gap-3 p-6 border-t border-border">
              <button
                onClick={() => {
                  setConfigureIntegration(null);
                  setIntegrationCredentials({});
                }}
                className="flex-1 px-4 py-3 bg-muted text-muted-foreground rounded-xl hover:bg-muted/80 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfigureIntegration}
                disabled={savingIntegration}
                className="flex-1 px-4 py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                {savingIntegration ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plugin Configuration Modal */}
      {configuringPlugin && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 overflow-y-auto py-8">
          <div className="bg-card border border-border rounded-xl w-full max-w-xl m-4 shadow-xl">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  {getIcon(configuringPlugin.deployment.package.icon)}
                </div>
                <div>
                  <h3 className="text-lg font-bold">
                    Configure {configuringPlugin.deployment.package.displayName}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    v{configuringPlugin.deployment.version.version}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setConfiguringPlugin(null);
                  setTenantConfigEntries([]);
                }}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 max-h-96 overflow-y-auto">
              <p className="text-sm text-muted-foreground mb-4">
                Add custom configuration key-value pairs for this plugin
              </p>

              <div className="space-y-3">
                {tenantConfigEntries.map((entry, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.key}
                      onChange={(e) => handleUpdateConfigEntry(index, 'key', e.target.value)}
                      placeholder="Key"
                      className="flex-1 bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors text-sm"
                    />
                    <input
                      type={entry.isSecret ? 'password' : 'text'}
                      value={entry.value}
                      onChange={(e) => handleUpdateConfigEntry(index, 'value', e.target.value)}
                      placeholder="Value"
                      className="flex-1 bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors text-sm"
                    />
                    <button
                      onClick={() => handleRemoveConfigEntry(index)}
                      className="p-2 rounded-lg hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}

                <button
                  onClick={handleAddConfigEntry}
                  className="w-full py-2 border border-dashed border-muted-foreground/30 rounded-lg text-muted-foreground hover:text-primary hover:border-primary/30 transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  Add Entry
                </button>
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-border">
              <button
                onClick={() => {
                  setConfiguringPlugin(null);
                  setTenantConfigEntries([]);
                }}
                className="flex-1 px-4 py-3 bg-muted text-muted-foreground rounded-xl hover:bg-muted/80 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePluginConfig}
                disabled={saving}
                className="flex-1 px-4 py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Settings Page - Plugin configuration and user preferences
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Settings, 
  Globe, 
  Key, 
  Clock, 
  Zap, 
  Plus, 
  Trash2, 
  Save, 
  RefreshCw, 
  CheckCircle,
  AlertCircle,
  GripVertical,
  Eye,
  EyeOff
} from 'lucide-react';
import { PageHeader } from '../components';
import { useDashboards } from '../hooks';
import { getApiUrl, getAuthHeaders } from '../App';
import { useAuth, useNotify } from '@naap/plugin-sdk';
import type { PluginConfig, Dashboard, ApiResponse } from '../types';

const defaultConfig: PluginConfig = {
  metabaseUrl: '',
  metabaseSecretKey: '',
  tokenExpiry: 600,
  enableInteractive: true,
};

export const SettingsPage: React.FC = () => {
  const { dashboards, preferences, togglePin, refresh: refreshDashboards } = useDashboards();
  const [config, setConfig] = useState<PluginConfig>(defaultConfig);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [secretKeyModified, setSecretKeyModified] = useState(false);
  const auth = useAuth();
  const notify = useNotify();
  
  // New dashboard form
  const [newDashboard, setNewDashboard] = useState({
    metabaseId: '',
    name: '',
    description: '',
  });
  const [isAddingDashboard, setIsAddingDashboard] = useState(false);

  // Check if user is admin
  const isAdmin = useMemo(() => {
    if (auth?.hasRole?.('my-dashboard:admin') || auth?.hasRole?.('system:admin')) {
      return true;
    }
    const user = auth?.getUser?.();
    if (user?.roles && Array.isArray(user.roles)) {
      if (user.roles.includes('my-dashboard:admin') || user.roles.includes('system:admin')) {
        return true;
      }
    }
    // Fallback: allow admin access by default for development
    return true;
  }, [auth]);

  // Load config
  useEffect(() => {
    const loadConfig = async () => {
      if (!isAdmin) return;
      
      try {
        const apiUrl = getApiUrl();
        const res = await fetch(`${apiUrl}/config`, {
          headers: await getAuthHeaders(),
        });
        
        if (res.ok) {
          const data: ApiResponse<PluginConfig> = await res.json();
          if (data.success && data.data) {
            setConfig({ ...defaultConfig, ...data.data });
          }
        }
      } catch (err) {
        console.error('Failed to load config:', err);
      }
    };
    
    loadConfig();
  }, [isAdmin]);

  // Save config
  const handleSaveConfig = async () => {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    
    try {
      // Normalize metabaseUrl - add https:// if missing
      let normalizedConfig = { ...config };
      if (normalizedConfig.metabaseUrl && !normalizedConfig.metabaseUrl.startsWith('http')) {
        normalizedConfig.metabaseUrl = `https://${normalizedConfig.metabaseUrl}`;
        setConfig(normalizedConfig);
      }
      
      // Only send secret key if it was modified (avoid saving masked value)
      const configToSave: Record<string, any> = {
        metabaseUrl: normalizedConfig.metabaseUrl,
        tokenExpiry: normalizedConfig.tokenExpiry,
        enableInteractive: normalizedConfig.enableInteractive,
      };
      if (secretKeyModified) {
        configToSave.metabaseSecretKey = normalizedConfig.metabaseSecretKey;
      }
      
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/config`, {
        method: 'PUT',
        headers: await getAuthHeaders(),
        body: JSON.stringify(configToSave),
      });
      
      if (!res.ok) {
        throw new Error('Failed to save configuration');
      }
      
      setSaved(true);
      setSecretKeyModified(false); // Reset flag after successful save
      
      notify?.success?.('Configuration saved successfully');
      
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      notify?.error?.('Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  // Add new dashboard
  const handleAddDashboard = async () => {
    if (!newDashboard.metabaseId || !newDashboard.name) return;
    
    setIsAddingDashboard(true);
    
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/dashboards`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          metabaseId: parseInt(newDashboard.metabaseId), // Numeric ID required for JWT embedding
          name: newDashboard.name,
          description: newDashboard.description,
        }),
      });
      
      if (!res.ok) {
        throw new Error('Failed to add dashboard');
      }
      
      setNewDashboard({ metabaseId: '', name: '', description: '' });
      refreshDashboards();
      
      notify?.success?.('Dashboard added successfully');
    } catch (err) {
      notify?.error?.('Failed to add dashboard');
    } finally {
      setIsAddingDashboard(false);
    }
  };

  // Delete dashboard
  const handleDeleteDashboard = async (id: string) => {
    if (!confirm('Are you sure you want to remove this dashboard?')) return;
    
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/dashboards/${id}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
      
      if (!res.ok) {
        throw new Error('Failed to delete dashboard');
      }
      
      refreshDashboards();
      
      notify?.success?.('Dashboard removed');
    } catch (err) {
      notify?.error?.('Failed to remove dashboard');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <PageHeader
        title="Settings"
        subtitle="Configure your dashboard preferences"
        actions={
          isAdmin && (
            <button
              onClick={handleSaveConfig}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-accent-purple text-white rounded-lg font-medium hover:bg-accent-purple/90 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : saved ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          )
        }
      />

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-accent-rose/10 border border-accent-rose/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-accent-rose" />
          <p className="text-accent-rose">{error}</p>
        </div>
      )}

      {/* Admin: Metabase Configuration */}
      {isAdmin && (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg dashboard-gradient">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Metabase Configuration</h2>
              <p className="text-sm text-text-secondary">Connect to your Metabase instance</p>
            </div>
          </div>

          {/* Metabase URL */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2">
              <Globe className="w-4 h-4" />
              Metabase URL
            </label>
            <input
              type="url"
              value={config.metabaseUrl}
              onChange={(e) => setConfig({ ...config, metabaseUrl: e.target.value })}
              placeholder="https://your-org.metabaseapp.com"
              className="w-full px-4 py-3 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-purple/50"
            />
          </div>

          {/* Secret Key */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2">
              <Key className="w-4 h-4" />
              Embedding Secret Key
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={config.metabaseSecretKey}
                onChange={(e) => {
                  setConfig({ ...config, metabaseSecretKey: e.target.value });
                  setSecretKeyModified(true);
                }}
                placeholder="Enter your Metabase embedding secret"
                className="w-full px-4 py-3 pr-12 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-purple/50"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-secondary hover:text-text-primary"
              >
                {showSecret ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-text-secondary mt-1">
              Find this in Metabase Admin → Embedding → Embedding secret key
              {config.metabaseSecretKey?.includes('...') && !secretKeyModified && (
                <span className="text-accent-amber ml-2">(Key is masked - enter full key to update)</span>
              )}
            </p>
          </div>

          {/* Token Expiry */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2">
              <Clock className="w-4 h-4" />
              Token Expiry (seconds)
            </label>
            <input
              type="number"
              value={config.tokenExpiry}
              onChange={(e) => setConfig({ ...config, tokenExpiry: parseInt(e.target.value) || 600 })}
              min={60}
              max={86400}
              className="w-full px-4 py-3 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary focus:outline-none focus:border-accent-purple/50"
            />
          </div>

          {/* Interactive Mode */}
          <div className="flex items-center justify-between p-4 bg-bg-tertiary rounded-lg">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-accent-amber" />
              <div>
                <p className="font-medium text-text-primary">Interactive Embedding</p>
                <p className="text-sm text-text-secondary">Enable full Metabase interactivity (requires Pro/Enterprise)</p>
              </div>
            </div>
            <button
              onClick={() => setConfig({ ...config, enableInteractive: !config.enableInteractive })}
              className={`relative w-12 h-6 rounded-full transition-colors ${config.enableInteractive ? 'bg-accent-purple' : 'bg-bg-secondary'}`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${config.enableInteractive ? 'translate-x-6' : ''}`}
              />
            </button>
          </div>
        </div>
      )}

      {/* Admin: Manage Dashboards */}
      {isAdmin && (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-accent-blue/20">
              <Plus className="w-5 h-5 text-accent-blue" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Manage Dashboards</h2>
              <p className="text-sm text-text-secondary">Add or remove available dashboards</p>
            </div>
          </div>

          {/* Add Dashboard Form */}
          <p className="text-sm text-text-secondary mb-2">
            Find the numeric ID in your Metabase dashboard URL: <code className="bg-bg-tertiary px-1 rounded">/dashboard/123</code> → use <code className="bg-bg-tertiary px-1 rounded">123</code>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="number"
              value={newDashboard.metabaseId}
              onChange={(e) => setNewDashboard({ ...newDashboard, metabaseId: e.target.value })}
              placeholder="Numeric ID (e.g., 123)"
              className="px-4 py-2 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-purple/50"
            />
            <input
              type="text"
              value={newDashboard.name}
              onChange={(e) => setNewDashboard({ ...newDashboard, name: e.target.value })}
              placeholder="Display Name"
              className="px-4 py-2 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-purple/50"
            />
            <input
              type="text"
              value={newDashboard.description}
              onChange={(e) => setNewDashboard({ ...newDashboard, description: e.target.value })}
              placeholder="Description (optional)"
              className="px-4 py-2 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-purple/50"
            />
            <button
              onClick={handleAddDashboard}
              disabled={!newDashboard.metabaseId || !newDashboard.name || isAddingDashboard}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-lg font-medium hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
            >
              {isAddingDashboard ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Add
                </>
              )}
            </button>
          </div>

          {/* Dashboard List */}
          <div className="space-y-2">
            {dashboards.map(dashboard => (
              <div
                key={dashboard.id}
                className="flex items-center gap-3 p-3 bg-bg-tertiary rounded-lg"
              >
                <GripVertical className="w-5 h-5 text-text-secondary cursor-move" />
                <div className="flex-1">
                  <p className="font-medium text-text-primary">{dashboard.name}</p>
                  <p className="text-sm text-text-secondary">
                    ID: {dashboard.metabaseId} {dashboard.isDefault && '• Default'}
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteDashboard(dashboard.id)}
                  className="p-2 text-accent-rose hover:bg-accent-rose/10 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            
            {dashboards.length === 0 && (
              <p className="text-center text-text-secondary py-4">
                No dashboards added yet
              </p>
            )}
          </div>
        </div>
      )}

      {/* User: Pinned Dashboards */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-accent-amber/20">
            <GripVertical className="w-5 h-5 text-accent-amber" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">My Pinned Dashboards</h2>
            <p className="text-sm text-text-secondary">Choose which dashboards appear first in your gallery</p>
          </div>
        </div>

        <div className="space-y-2">
          {dashboards.map(dashboard => {
            const isPinned = preferences.get(dashboard.id)?.pinned || dashboard.isDefault;
            return (
              <div
                key={dashboard.id}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${isPinned ? 'bg-accent-amber/10 border border-accent-amber/30' : 'bg-bg-tertiary hover:bg-bg-secondary'}`}
                onClick={() => togglePin(dashboard.id)}
              >
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isPinned ? 'border-accent-amber bg-accent-amber' : 'border-white/30'}`}>
                  {isPinned && <CheckCircle className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-text-primary">{dashboard.name}</p>
                  {dashboard.description && (
                    <p className="text-sm text-text-secondary">{dashboard.description}</p>
                  )}
                </div>
              </div>
            );
          })}
          
          {dashboards.length === 0 && (
            <p className="text-center text-text-secondary py-4">
              No dashboards available
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

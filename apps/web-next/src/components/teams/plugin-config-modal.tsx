'use client';

/**
 * Plugin Configuration Modal
 * Allows team owners/admins to configure team plugin sharedConfig.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, Loader2, AlertCircle } from 'lucide-react';

interface PluginConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId: string;
  pluginInstallId: string;
  pluginName: string;
  onSaved?: () => void;
}

export function PluginConfigModal({
  isOpen,
  onClose,
  teamId,
  pluginInstallId,
  pluginName,
  onSaved,
}: PluginConfigModalProps) {
  const [config, setConfig] = useState<string>('{}');
  const [originalConfig, setOriginalConfig] = useState<string>('{}');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(
        `/api/v1/teams/${teamId}/plugins/${pluginInstallId}/config`,
        { credentials: 'include' }
      );
      const data = await res.json();

      if (res.ok) {
        const configStr = JSON.stringify(data.sharedConfig || {}, null, 2);
        setConfig(configStr);
        setOriginalConfig(configStr);
      } else {
        setError(data.error || 'Failed to load configuration');
      }
    } catch {
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [teamId, pluginInstallId]);

  useEffect(() => {
    if (isOpen && pluginInstallId) {
      loadConfig();
    }
  }, [isOpen, pluginInstallId, loadConfig]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, config, originalConfig]);

  const hasChanges = config !== originalConfig;

  function handleClose() {
    if (hasChanges) {
      if (!window.confirm('You have unsaved changes. Are you sure you want to close?')) {
        return;
      }
    }
    onClose();
  }

  function handleConfigChange(value: string) {
    setConfig(value);
    setParseError(null);

    // Validate JSON
    try {
      JSON.parse(value);
    } catch {
      setParseError('Invalid JSON format');
    }
  }

  async function handleSave() {
    // Validate JSON before saving
    let parsedConfig;
    try {
      parsedConfig = JSON.parse(config);
    } catch {
      setParseError('Invalid JSON format');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const res = await fetch(
        `/api/v1/teams/${teamId}/plugins/${pluginInstallId}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sharedConfig: parsedConfig }),
        }
      );

      const data = await res.json();

      if (res.ok) {
        setOriginalConfig(config);
        onSaved?.();
        onClose();
      } else {
        setError(data.error || 'Failed to save configuration');
      }
    } catch (err) {
      setError('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  const canSave = hasChanges && !parseError;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-lg font-bold">Configure: {pluginName}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Edit the shared configuration for this plugin
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 bg-destructive/10 text-destructive rounded-lg">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <>
              <label className="block text-sm font-medium mb-2">
                Plugin Settings (JSON)
              </label>
              <textarea
                value={config}
                onChange={(e) => handleConfigChange(e.target.value)}
                className={`w-full h-64 p-4 bg-muted/50 border rounded-lg font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                  parseError ? 'border-destructive' : 'border-border'
                }`}
                placeholder="{}"
                spellCheck={false}
              />
              {parseError && (
                <p className="mt-2 text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {parseError}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                This configuration is shared with all team members who have access to this plugin.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Configuration
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

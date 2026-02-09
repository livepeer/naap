'use client';

/**
 * Personal Plugin Configuration Modal
 * Allows team members with canConfigure access to set personal config overrides.
 * Shows side-by-side: team defaults vs personal overrides.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, Loader2, AlertCircle, RotateCcw, ArrowRight } from 'lucide-react';

interface PersonalConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId: string;
  pluginInstallId: string;
  pluginName: string;
  onSaved?: () => void;
}

interface ConfigEntry {
  key: string;
  teamValue: unknown;
  personalValue: unknown | undefined;
  isOverridden: boolean;
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(not set)';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function flattenConfig(obj: Record<string, unknown>, prefix = ''): Array<{ key: string; value: unknown }> {
  const result: Array<{ key: string; value: unknown }> = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result.push(...flattenConfig(value as Record<string, unknown>, fullKey));
    } else {
      result.push({ key: fullKey, value });
    }
  }

  return result;
}

export function PersonalConfigModal({
  isOpen,
  onClose,
  teamId,
  pluginInstallId,
  pluginName,
  onSaved,
}: PersonalConfigModalProps) {
  const [sharedConfig, setSharedConfig] = useState<Record<string, unknown>>({});
  const [personalConfig, setPersonalConfig] = useState<string>('{}');
  const [originalPersonalConfig, setOriginalPersonalConfig] = useState<string>('{}');
  const [canConfigure, setCanConfigure] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(
        `/api/v1/teams/${teamId}/members/me/plugins/${pluginInstallId}/config`,
        { credentials: 'include' }
      );
      const data = await res.json();

      if (res.ok && data.success) {
        setSharedConfig(data.data.sharedConfig || {});
        const personalStr = JSON.stringify(data.data.personalConfig || {}, null, 2);
        setPersonalConfig(personalStr);
        setOriginalPersonalConfig(personalStr);
        setCanConfigure(data.data.canConfigure);
      } else {
        setError(data.error?.message || data.error || 'Failed to load configuration');
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

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, personalConfig, originalPersonalConfig]);

  const hasChanges = personalConfig !== originalPersonalConfig;
  const hasPersonalOverrides = originalPersonalConfig !== '{}';

  function handleClose() {
    if (hasChanges) {
      if (!window.confirm('You have unsaved changes. Are you sure you want to close?')) {
        return;
      }
    }
    onClose();
  }

  function handleConfigChange(value: string) {
    setPersonalConfig(value);
    setParseError(null);

    try {
      JSON.parse(value);
    } catch {
      setParseError('Invalid JSON format');
    }
  }

  async function handleSave() {
    let parsedConfig;
    try {
      parsedConfig = JSON.parse(personalConfig);
    } catch {
      setParseError('Invalid JSON format');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const res = await fetch(
        `/api/v1/teams/${teamId}/members/me/plugins/${pluginInstallId}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ personalConfig: parsedConfig }),
        }
      );

      const data = await res.json();

      if (res.ok && data.success) {
        setOriginalPersonalConfig(personalConfig);
        onSaved?.();
        onClose();
      } else {
        setError(data.error?.message || data.error || 'Failed to save configuration');
      }
    } catch {
      setError('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!window.confirm('This will remove all your personal overrides and use team defaults. Continue?')) {
      return;
    }

    try {
      setResetting(true);
      setError(null);

      const res = await fetch(
        `/api/v1/teams/${teamId}/members/me/plugins/${pluginInstallId}/config`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );

      const data = await res.json();

      if (res.ok && data.success) {
        setPersonalConfig('{}');
        setOriginalPersonalConfig('{}');
        onSaved?.();
        onClose();
      } else {
        setError(data.error?.message || data.error || 'Failed to reset configuration');
      }
    } catch {
      setError('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  // Build config comparison entries
  const configEntries: ConfigEntry[] = [];
  let parsedPersonal: Record<string, unknown> = {};
  try {
    parsedPersonal = JSON.parse(personalConfig);
  } catch {
    // ignore parse errors for display
  }

  // Get all keys from both configs
  const allKeys = new Set([
    ...flattenConfig(sharedConfig).map(e => e.key),
    ...flattenConfig(parsedPersonal).map(e => e.key),
  ]);

  const flatShared = flattenConfig(sharedConfig);
  const flatPersonal = flattenConfig(parsedPersonal);

  for (const key of allKeys) {
    const teamEntry = flatShared.find(e => e.key === key);
    const personalEntry = flatPersonal.find(e => e.key === key);

    configEntries.push({
      key,
      teamValue: teamEntry?.value,
      personalValue: personalEntry?.value,
      isOverridden: personalEntry !== undefined,
    });
  }

  const canSave = hasChanges && !parseError && canConfigure;

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
        className="relative w-full max-w-3xl bg-card border border-border rounded-xl shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold">My Settings: {pluginName}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Personal overrides for your account only
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
        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 bg-destructive/10 text-destructive rounded-lg">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : !canConfigure ? (
            <div className="flex items-center gap-3 p-4 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-lg">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>You do not have permission to configure this plugin. Contact your team admin.</span>
            </div>
          ) : (
            <>
              {/* Comparison View */}
              {configEntries.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-3">Current Configuration</h3>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="grid grid-cols-3 gap-px bg-border text-xs font-medium">
                      <div className="bg-muted px-3 py-2">Setting</div>
                      <div className="bg-muted px-3 py-2">Team Default</div>
                      <div className="bg-muted px-3 py-2">Your Override</div>
                    </div>
                    <div className="divide-y divide-border">
                      {configEntries.map((entry) => (
                        <div key={entry.key} className="grid grid-cols-3 gap-px bg-border">
                          <div className="bg-card px-3 py-2 font-mono text-xs break-all">
                            {entry.key}
                          </div>
                          <div className="bg-card px-3 py-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">
                            {formatValue(entry.teamValue)}
                          </div>
                          <div className={`bg-card px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all flex items-start gap-2 ${
                            entry.isOverridden ? 'text-primary' : 'text-muted-foreground'
                          }`}>
                            {entry.isOverridden && (
                              <ArrowRight className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            )}
                            {entry.isOverridden ? formatValue(entry.personalValue) : '(using default)'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Edit JSON */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Personal Overrides (JSON)
                </label>
                <textarea
                  value={personalConfig}
                  onChange={(e) => handleConfigChange(e.target.value)}
                  className={`w-full h-48 p-4 bg-muted/50 border rounded-lg font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 ${
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
                  Only add values you want to override. Empty object {} means use all team defaults.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-6 border-t border-border flex-shrink-0">
          <div>
            {hasPersonalOverrides && canConfigure && (
              <button
                onClick={handleReset}
                disabled={resetting || saving}
                className="flex items-center gap-2 px-4 py-2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {resetting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4" />
                )}
                Reset to Team Defaults
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
              disabled={saving || resetting}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving || resetting}
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
                  Save
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

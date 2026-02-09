/**
 * Settings Page - API Key Configuration and Usage Stats
 */

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Key, Check, X, Loader2, BarChart3, Clock, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getSettings,
  updateSettings,
  testApiKey,
  getUsageStats,
  getSessionHistory,
  type SettingsData,
  type UsageStats,
  type SessionRecord,
} from '../lib/api';

export const Settings: React.FC = () => {
  const navigate = useNavigate();
  
  // Settings state
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [defaultSeed, setDefaultSeed] = useState(42);
  const [negativePrompt, setNegativePrompt] = useState('');
  
  // Usage state
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [settingsData, usageData, sessionsData] = await Promise.all([
        getSettings(),
        getUsageStats(),
        getSessionHistory(10),
      ]);

      setSettings(settingsData);
      setDefaultPrompt(settingsData.defaultPrompt);
      setDefaultSeed(settingsData.defaultSeed);
      setNegativePrompt(settingsData.negativePrompt);
      setUsage(usageData);
      setSessions(sessionsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const updates: Record<string, unknown> = {
        defaultPrompt,
        defaultSeed,
        negativePrompt,
      };

      if (apiKey) {
        updates.apiKey = apiKey;
      }

      const updated = await updateSettings(updates);
      setSettings(updated);
      setApiKey(''); // Clear the API key field after saving
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestApiKey = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      
      await testApiKey(apiKey || undefined);
      setTestResult('success');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatDuration = (mins: number) => {
    if (mins < 1) return `${Math.round(mins * 60)}s`;
    if (mins < 60) return `${Math.round(mins)}m`;
    return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-gray-400">Configure your Daydream AI Video settings</p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300">
          {error}
        </div>
      )}

      {/* API Key Section */}
      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary-500/20">
            <Key className="w-5 h-5 text-primary-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">API Key</h2>
            <p className="text-sm text-gray-400">
              {settings?.hasApiKey ? 'API key is configured' : 'Using default API key'}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-2">
              Daydream API Key
              <a
                href="https://app.daydream.live/dashboard/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-primary-400 hover:underline"
              >
                Get one here
              </a>
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder={settings?.hasApiKey ? '••••••••••••••••' : 'Enter your API key'}
                className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-primary-500"
              />
              <button
                onClick={handleTestApiKey}
                disabled={testing}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-2"
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : testResult === 'success' ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : testResult === 'error' ? (
                  <X className="w-4 h-4 text-red-400" />
                ) : null}
                Test
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Default Settings */}
      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">Default Parameters</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Default Prompt</label>
            <input
              type="text"
              value={defaultPrompt}
              onChange={(e) => setDefaultPrompt(e.target.value)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Default Seed</label>
            <input
              type="number"
              value={defaultSeed}
              onChange={(e) => setDefaultSeed(parseInt(e.target.value) || 42)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-primary-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Negative Prompt</label>
          <input
            type="text"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-primary-500"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save Settings
        </button>
      </div>

      {/* Usage Statistics */}
      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent-purple/20">
            <BarChart3 className="w-5 h-5 text-accent-purple" />
          </div>
          <h2 className="text-lg font-semibold">Usage Statistics</h2>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-primary-400">
              {usage?.totalSessions || 0}
            </div>
            <div className="text-sm text-gray-400 flex items-center justify-center gap-1">
              <Video className="w-4 h-4" />
              Total Sessions
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-accent-purple">
              {formatDuration(usage?.totalMinutes || 0)}
            </div>
            <div className="text-sm text-gray-400 flex items-center justify-center gap-1">
              <Clock className="w-4 h-4" />
              Total Time
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-accent-green">
              {usage?.activeSessions || 0}
            </div>
            <div className="text-sm text-gray-400 flex items-center justify-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Active Now
            </div>
          </div>
        </div>
      </div>

      {/* Session History */}
      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Sessions</h2>
        </div>

        {sessions.length === 0 ? (
          <p className="text-gray-400 text-center py-8">No sessions yet. Start streaming!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-400 border-b border-gray-700">
                  <th className="pb-3">Started</th>
                  <th className="pb-3">Duration</th>
                  <th className="pb-3">Prompt</th>
                  <th className="pb-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-gray-700/50">
                    <td className="py-3 text-sm">
                      {formatDate(session.startedAt)}
                    </td>
                    <td className="py-3 text-sm">
                      {formatDuration(session.durationMins)}
                    </td>
                    <td className="py-3 text-sm text-gray-400 max-w-[200px] truncate">
                      {session.prompt || '-'}
                    </td>
                    <td className="py-3">
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${
                          session.status === 'active'
                            ? 'bg-green-500/20 text-green-400'
                            : session.status === 'error'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {session.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;

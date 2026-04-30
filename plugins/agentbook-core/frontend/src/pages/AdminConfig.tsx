import React, { useEffect, useState } from 'react';
import { Settings, Key, Cpu, Plus, Trash2, Check, TestTube, Loader2 } from 'lucide-react';

const API = '/api/v1/agentbook-core';

interface LLMConfig {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
  modelFast: string;
  modelStandard: string;
  modelPremium: string;
  modelVision: string | null;
}

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', models: { fast: 'gemini-2.0-flash', standard: 'gemini-2.5-flash', premium: 'gemini-2.5-pro' } },
  { id: 'openai', name: 'OpenAI', models: { fast: 'gpt-4o-mini', standard: 'gpt-4o', premium: 'o1' } },
  { id: 'claude', name: 'Anthropic Claude', models: { fast: 'claude-haiku-4-5', standard: 'claude-sonnet-4-5', premium: 'claude-opus-4' } },
  { id: 'kimi', name: 'Kimi (Moonshot)', models: { fast: 'kimi-lite', standard: 'kimi-standard', premium: 'kimi-pro' } },
  { id: 'minimax', name: 'MiniMax', models: { fast: 'abab5.5-chat', standard: 'abab6-chat', premium: 'abab6.5-chat' } },
];

export const AdminConfigPage: React.FC = () => {
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New provider form state
  const [newProvider, setNewProvider] = useState('gemini');
  const [newName, setNewName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');

  useEffect(() => {
    fetch(`${API}/admin/llm-configs`).then(r => r.json())
      .then(d => { if (d.data) setConfigs(d.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const addProvider = async () => {
    const preset = PROVIDERS.find(p => p.id === newProvider);
    const res = await fetch(`${API}/admin/llm-configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName || preset?.name || newProvider,
        provider: newProvider,
        apiKey: newApiKey,
        modelFast: preset?.models.fast,
        modelStandard: preset?.models.standard,
        modelPremium: preset?.models.premium,
        isDefault: configs.length === 0,
      }),
    });
    const d = await res.json();
    if (d.success) {
      setConfigs(prev => [...prev, d.data]);
      setShowAddForm(false);
      setNewApiKey('');
      setNewName('');
    }
  };

  const toggleDefault = async (id: string) => {
    await fetch(`${API}/admin/llm-configs/${id}/set-default`, { method: 'POST' });
    setConfigs(prev => prev.map(c => ({ ...c, isDefault: c.id === id })));
  };

  const deleteConfig = async (id: string) => {
    await fetch(`${API}/admin/llm-configs/${id}`, { method: 'DELETE' });
    setConfigs(prev => prev.filter(c => c.id !== id));
  };

  const testProvider = async (id: string) => {
    setTesting(id);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/admin/llm-configs/${id}/test`, { method: 'POST' });
      const d = await res.json();
      setTestResult(d.success ? `✓ ${d.data.model}: "${d.data.response?.slice(0, 100)}..." (${d.data.latencyMs}ms)` : `✗ ${d.error}`);
    } catch (err) {
      setTestResult(`✗ ${err}`);
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="px-4 py-5 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Agent Configuration</h1>
      </div>

      {/* LLM Providers */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium flex items-center gap-2"><Cpu className="w-5 h-5" /> LLM Providers</h2>
          <button onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm">
            <Plus className="w-4 h-4" /> Add Provider
          </button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="bg-card border border-border rounded-xl p-5 mb-4">
            <h3 className="font-medium mb-3">Add LLM Provider</h3>
            <div className="space-y-3">
              <select value={newProvider} onChange={e => setNewProvider(e.target.value)}
                className="w-full p-3 border border-border rounded-lg bg-background">
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="text" placeholder="Display name (optional)" value={newName} onChange={e => setNewName(e.target.value)}
                className="w-full p-3 border border-border rounded-lg bg-background" />
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="password" placeholder="API Key" value={newApiKey} onChange={e => setNewApiKey(e.target.value)}
                  className="w-full pl-10 p-3 border border-border rounded-lg bg-background font-mono text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={addProvider} disabled={!newApiKey}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50">Save</button>
                <button onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {loading && <p className="text-muted-foreground">Loading...</p>}

        {/* Provider list */}
        <div className="space-y-3">
          {configs.map(cfg => (
            <div key={cfg.id} className={`bg-card border rounded-xl p-4 ${cfg.isDefault ? 'border-primary' : 'border-border'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${cfg.enabled ? 'bg-green-500' : 'bg-red-500'}`} />
                  <h3 className="font-medium">{cfg.name}</h3>
                  {cfg.isDefault && <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">Default</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => testProvider(cfg.id)} disabled={testing === cfg.id}
                    className="p-2 rounded-lg hover:bg-muted transition-colors" title="Test connection">
                    {testing === cfg.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
                  </button>
                  {!cfg.isDefault && (
                    <button onClick={() => toggleDefault(cfg.id)} className="p-2 rounded-lg hover:bg-muted" title="Set as default">
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => deleteConfig(cfg.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-red-500" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Provider: {cfg.provider} · Key: {cfg.apiKey.slice(0, 8)}...{cfg.apiKey.slice(-4)}</p>
                <p>Models: fast={cfg.modelFast}, standard={cfg.modelStandard}, premium={cfg.modelPremium}</p>
              </div>
            </div>
          ))}
          {configs.length === 0 && !loading && (
            <div className="text-center py-8 text-muted-foreground">
              <Cpu className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>No LLM providers configured. Add one to enable AI features.</p>
            </div>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${testResult.startsWith('✓') ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
            {testResult}
          </div>
        )}
      </div>
    </div>
  );
};

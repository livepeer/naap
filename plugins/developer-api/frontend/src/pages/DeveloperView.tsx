import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Box, Key, BarChart3, BookOpen, Plus, Copy, Trash2, Search,
  Check, AlertCircle, Clock, Eye, EyeOff, Shield, X,
} from 'lucide-react';
import { Card, Badge } from '@naap/ui';
import { getServiceOrigin } from '@naap/plugin-sdk';

type TabId = 'models' | 'api-keys' | 'usage' | 'docs';

interface AIModel {
  id: string;
  name: string;
  tagline: string;
  type: string;
  featured: boolean;
  realtime: boolean;
  costPerMin: { min: number; max: number };
  latencyP50: number;
  gatewayCount: number;
  badges: string[];
}

interface ApiKey {
  id: string;
  name: string;
  token: string;
  address: string;
  scope: string;
  ttl: string;
  expiresAt: string;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked';
}

const JWT_ISSUER_URL = 'http://localhost:8082';

// '' in production (same-origin), 'http://localhost:4011' in dev
const BASE_URL = getServiceOrigin('developer-api');

const tabs = [
  { id: 'models' as TabId, label: 'Models', icon: <Box size={18} /> },
  { id: 'api-keys' as TabId, label: 'API Keys', icon: <Key size={18} /> },
  { id: 'usage' as TabId, label: 'Usage & Billing', icon: <BarChart3 size={18} /> },
  { id: 'docs' as TabId, label: 'Docs', icon: <BookOpen size={18} /> },
];

const TTL_OPTIONS = [
  { value: '1h', label: '1 hour', desc: 'Short-lived, for quick tests' },
  { value: '8h', label: '8 hours', desc: 'Default, good for a dev session' },
  { value: '24h', label: '24 hours', desc: 'One day of access' },
  { value: '168h', label: '7 days', desc: 'Week-long development' },
  { value: '720h', label: '30 days', desc: 'Persistent access, rotate regularly' },
];

const SCOPE_OPTIONS = [
  { value: 'sign:orchestrator', label: 'Orchestrator Signing', desc: 'Sign orchestrator discovery info' },
  { value: 'sign:payment', label: 'Payment Generation', desc: 'Generate payment tickets for AI jobs' },
  { value: 'sign:byoc', label: 'BYOC Signing', desc: 'Sign bring-your-own-compute requests' },
];

const STORAGE_KEY = 'naap_api_keys';

function loadStoredKeys(): ApiKey[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const keys: ApiKey[] = JSON.parse(stored);
    // Update status based on expiration
    return keys.map(k => ({
      ...k,
      status: k.status === 'revoked'
        ? 'revoked'
        : new Date(k.expiresAt) < new Date() ? 'expired' : 'active',
    }));
  } catch {
    return [];
  }
}

function saveStoredKeys(keys: ApiKey[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

function getSessionJWT(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('naap_remote_signer_token');
    if (!stored) return null;
    return JSON.parse(stored).jwt || null;
  } catch {
    return null;
  }
}

function getWalletAddress(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('naap_remote_signer_token');
    if (!stored) return null;
    return JSON.parse(stored).address || null;
  } catch {
    return null;
  }
}

export const DeveloperView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('models');
  const [models, setModels] = useState<AIModel[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [_loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [mounted, setMounted] = useState(false);

  // Create Key modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [selectedTTL, setSelectedTTL] = useState('8h');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['sign:orchestrator', 'sign:payment', 'sign:byoc']);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Newly created key (shown once for copying)
  const [newlyCreated, setNewlyCreated] = useState<ApiKey | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
    loadData();
  }, []);

  useEffect(() => {
    if (mounted) {
      setApiKeys(loadStoredKeys());
    }
  }, [mounted]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [modelsJson, keysJson] = await Promise.all([
        fetch(`${BASE_URL}/api/v1/developer/models`).then(r => r.json()),
        fetch(`${BASE_URL}/api/v1/developer/keys`).then(r => r.json()),
      ]);
      // API routes wrap responses in { success, data: { models/keys }, meta }
      const modelsPayload = modelsJson.data ?? modelsJson;
      const keysPayload = keysJson.data ?? keysJson;
      setModels(modelsPayload.models || []);
      setApiKeys(keysPayload.keys || []);
    } catch (err) {
      console.error('Failed to load data:', err);
      setModels(getMockModels());
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  const toggleReveal = (id: string) => {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateKey = async () => {
    const sessionJWT = getSessionJWT();
    if (!sessionJWT) {
      setCreateError('You must sign in with Ethereum first. Go to the login page to authenticate.');
      return;
    }

    if (!keyName.trim()) {
      setCreateError('Please enter a name for this key.');
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const response = await fetch(`${JWT_ISSUER_URL}/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionJWT}`,
        },
        body: JSON.stringify({
          name: keyName.trim(),
          ttl: selectedTTL,
          scope: selectedScopes.join(' '),
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      const newKey: ApiKey = {
        id: `key_${Date.now()}`,
        name: data.name || keyName.trim(),
        token: data.token,
        address: data.address,
        scope: data.scope,
        ttl: data.ttl || selectedTTL,
        expiresAt: data.expires_at,
        createdAt: new Date().toISOString(),
        status: 'active',
      };

      const updatedKeys = [newKey, ...apiKeys];
      setApiKeys(updatedKeys);
      saveStoredKeys(updatedKeys);
      setNewlyCreated(newKey);

      // Also update the session token to this latest one
      localStorage.setItem('naap_remote_signer_token', JSON.stringify({
        jwt: data.token,
        address: data.address,
        expiresAt: data.expires_at,
        createdAt: new Date().toISOString(),
        scope: data.scope,
      }));

      // Reset form
      setKeyName('');
      setSelectedTTL('8h');
      setSelectedScopes(['sign:orchestrator', 'sign:payment', 'sign:byoc']);
      setShowCreateModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create key';
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = (id: string) => {
    const updated = apiKeys.map(k =>
      k.id === id ? { ...k, status: 'revoked' as const } : k
    );
    setApiKeys(updated);
    saveStoredKeys(updated);
  };

  const handleDeleteKey = (id: string) => {
    const updated = apiKeys.filter(k => k.id !== id);
    setApiKeys(updated);
    saveStoredKeys(updated);
  };

  const formatExpiry = (expiresAt: string) => {
    const expiry = new Date(expiresAt);
    const now = new Date();
    const diffMs = expiry.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (diffMs < 0) return 'Expired';
    if (diffHours < 1) return `${diffMinutes}m`;
    if (diffHours < 24) return `${diffHours}h ${diffMinutes}m`;
    return `${Math.floor(diffHours / 24)}d ${diffHours % 24}h`;
  };

  const truncateToken = (token: string) =>
    `${token.substring(0, 24)}...${token.substring(token.length - 12)}`;

  const filteredModels = models.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeKeys = apiKeys.filter(k => k.status === 'active');
  const inactiveKeys = apiKeys.filter(k => k.status !== 'active');
  const walletAddress = mounted ? getWalletAddress() : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-outfit font-bold text-text-primary">Developer API Manager</h1>
        <p className="text-text-secondary mt-1">Explore models, manage API keys, and track usage</p>
      </div>

      <div className="border-b border-white/10">
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all ${
                activeTab === tab.id ? 'text-accent-emerald' : 'text-text-secondary hover:text-text-primary'
              }`}>
              {tab.icon}
              {tab.label}
              {tab.id === 'api-keys' && activeKeys.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-accent-emerald/20 text-accent-emerald">
                  {activeKeys.length}
                </span>
              )}
              {activeTab === tab.id && (
                <motion.div layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-emerald"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
              )}
            </button>
          ))}
        </nav>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.15 }}>

          {activeTab === 'models' && (
            <div className="space-y-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
                <input type="text" placeholder="Search models..." value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-blue" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredModels.map((model) => (
                  <Card key={model.id} className="hover:border-accent-blue/30 transition-all cursor-pointer">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-text-primary">{model.name}</h3>
                        <p className="text-xs text-text-secondary">{model.type}</p>
                      </div>
                      {model.featured && <Badge variant="emerald">Featured</Badge>}
                    </div>
                    <p className="text-sm text-text-secondary mb-4 line-clamp-2">{model.tagline}</p>
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                      <span>${model.costPerMin.min.toFixed(2)} - ${model.costPerMin.max.toFixed(2)}/min</span>
                      <span>{model.gatewayCount} gateways</span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'api-keys' && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-text-secondary">{activeKeys.length} active key{activeKeys.length !== 1 ? 's' : ''}</p>
                  {walletAddress && (
                    <p className="text-xs text-text-secondary mt-0.5 font-mono">{walletAddress}</p>
                  )}
                </div>
                <button
                  onClick={() => { setShowCreateModal(true); setCreateError(null); setNewlyCreated(null); }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-accent-emerald text-white rounded-xl font-medium hover:bg-accent-emerald/90 transition-all"
                >
                  <Plus size={16} /> Create Key
                </button>
              </div>

              {/* Newly created key banner */}
              {newlyCreated && (
                <Card className="bg-accent-emerald/5 border-accent-emerald/30">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Check size={20} className="text-accent-emerald" />
                      <h3 className="font-bold text-text-primary">Key Created: {newlyCreated.name}</h3>
                    </div>
                    <button onClick={() => setNewlyCreated(null)} className="p-1 hover:bg-white/5 rounded-lg">
                      <X size={16} className="text-text-secondary" />
                    </button>
                  </div>
                  <p className="text-sm text-accent-amber mb-3">Copy this token now. You won't see the full value again.</p>
                  <div className="relative group">
                    <div className="bg-bg-tertiary border border-white/10 rounded-lg p-4 font-mono text-xs break-all text-text-secondary">
                      {newlyCreated.token}
                    </div>
                    <button
                      onClick={() => handleCopy(newlyCreated.token, 'new')}
                      className="absolute top-2 right-2 px-3 py-1.5 bg-accent-emerald text-white rounded-lg text-xs font-medium hover:bg-accent-emerald/90 transition-all"
                    >
                      {copiedId === 'new' ? 'Copied!' : 'Copy Token'}
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-text-secondary">
                    <span className="flex items-center gap-1"><Clock size={12} /> Expires: {formatExpiry(newlyCreated.expiresAt)}</span>
                    <span className="flex items-center gap-1"><Shield size={12} /> {newlyCreated.scope}</span>
                  </div>
                </Card>
              )}

              {/* No wallet connected */}
              {!walletAddress && mounted && (
                <Card className="bg-accent-amber/5 border-accent-amber/20">
                  <div className="flex items-start gap-3 p-2">
                    <AlertCircle size={20} className="text-accent-amber flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-text-primary mb-1">Wallet Not Connected</p>
                      <p className="text-sm text-text-secondary mb-3">
                        Sign in with Ethereum to create API keys. Keys are JWTs signed by the Livepeer jwt-issuer
                        and authenticate your requests to the remote signer payment service.
                      </p>
                      <a href="/login" className="inline-flex items-center gap-2 px-4 py-2 bg-accent-emerald text-white rounded-lg text-sm font-medium hover:bg-accent-emerald/90 transition-all">
                        <Key size={16} />
                        Sign In With Ethereum
                      </a>
                    </div>
                  </div>
                </Card>
              )}

              {/* Active Keys */}
              {activeKeys.length > 0 && (
                <Card>
                  <div className="space-y-1">
                    {activeKeys.map((key) => (
                      <div key={key.id} className="flex items-center justify-between p-4 bg-bg-tertiary/50 rounded-xl">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-accent-emerald/10 flex items-center justify-center flex-shrink-0">
                            <Key size={20} className="text-accent-emerald" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-text-primary">{key.name}</p>
                            <div className="flex items-center gap-3 text-xs text-text-secondary mt-0.5">
                              <span className="flex items-center gap-1">
                                <Clock size={11} /> {formatExpiry(key.expiresAt)}
                              </span>
                              <span className="truncate font-mono">
                                {revealedKeys.has(key.id) ? key.token.substring(0, 60) + '...' : truncateToken(key.token)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                          <Badge variant="emerald">active</Badge>
                          <button onClick={() => handleCopy(key.token, key.id)} className="p-2 hover:bg-white/5 rounded-lg" title="Copy token">
                            {copiedId === key.id ? <Check size={16} className="text-accent-emerald" /> : <Copy size={16} className="text-text-secondary" />}
                          </button>
                          <button onClick={() => toggleReveal(key.id)} className="p-2 hover:bg-white/5 rounded-lg" title="Show/hide token">
                            {revealedKeys.has(key.id) ? <EyeOff size={16} className="text-text-secondary" /> : <Eye size={16} className="text-text-secondary" />}
                          </button>
                          <button onClick={() => handleRevokeKey(key.id)} className="p-2 hover:bg-white/5 rounded-lg text-accent-rose" title="Revoke key">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Inactive / Expired / Revoked Keys */}
              {inactiveKeys.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-text-secondary mb-3">Expired / Revoked</h3>
                  <Card>
                    <div className="space-y-1">
                      {inactiveKeys.map((key) => (
                        <div key={key.id} className="flex items-center justify-between p-3 bg-bg-tertiary/30 rounded-xl opacity-60">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                              <Key size={16} className="text-text-secondary" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm text-text-secondary">{key.name}</p>
                              <p className="text-xs text-text-secondary font-mono truncate">{truncateToken(key.token)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                            <Badge variant="rose">{key.status}</Badge>
                            <button onClick={() => handleDeleteKey(key.id)} className="p-2 hover:bg-white/5 rounded-lg text-text-secondary" title="Delete">
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}

              {/* Empty state */}
              {apiKeys.length === 0 && walletAddress && (
                <Card>
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                      <Key size={32} className="text-text-secondary opacity-40" />
                    </div>
                    <h3 className="text-lg font-bold text-text-primary mb-2">No API Keys Yet</h3>
                    <p className="text-text-secondary mb-6 max-w-sm mx-auto">
                      Create your first API key to start using the Livepeer remote signer and offchain gateway.
                    </p>
                    <button
                      onClick={() => { setShowCreateModal(true); setCreateError(null); }}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent-emerald text-white rounded-xl font-medium hover:bg-accent-emerald/90 transition-all"
                    >
                      <Plus size={16} /> Create Your First Key
                    </button>
                  </div>
                </Card>
              )}

              {/* How API Keys Work */}
              <Card className="bg-accent-blue/5 border-accent-blue/10">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent-blue/20 flex items-center justify-center flex-shrink-0">
                    <Shield size={20} className="text-accent-blue" />
                  </div>
                  <div className="text-sm">
                    <p className="font-medium text-text-primary mb-1">How API Keys Work</p>
                    <p className="text-text-secondary">
                      API keys are RS256 JWTs issued by the Livepeer jwt-issuer and authenticated by the remote signer.
                      Include them in the <code className="px-1.5 py-0.5 bg-bg-tertiary rounded text-xs">Authorization: Bearer &lt;key&gt;</code> header
                      when calling the remote signer or offchain gateway. Each key has its own TTL and scopes.
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'usage' && (
            <Card>
              <div className="text-center py-12">
                <BarChart3 size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
                <h3 className="text-lg font-bold text-text-primary mb-2">Usage Dashboard</h3>
                <p className="text-text-secondary">Track your API usage and costs here</p>
              </div>
            </Card>
          )}

          {activeTab === 'docs' && (
            <Card>
              <div className="prose prose-invert max-w-none">
                <h2 className="text-xl font-bold text-text-primary mb-4">Getting Started</h2>
                <p className="text-text-secondary mb-4">
                  Welcome to the NaaP Developer API. Follow these steps to integrate:
                </p>
                <ol className="list-decimal list-inside space-y-3 text-text-secondary">
                  <li><strong>Sign in with Ethereum</strong> at the login page to authenticate your wallet</li>
                  <li><strong>Create an API key</strong> in the API Keys tab with your desired lifetime</li>
                  <li><strong>Use the key</strong> in the <code>Authorization: Bearer</code> header</li>
                  <li><strong>Call the remote signer</strong> to get orchestrator signatures and payment tickets</li>
                  <li><strong>Monitor usage</strong> in the Usage & Billing tab</li>
                </ol>
                <h3 className="text-lg font-bold text-text-primary mt-8 mb-3">Example: Sign Orchestrator Info</h3>
                <pre className="bg-bg-tertiary rounded-xl p-4 text-sm overflow-x-auto">
{`curl -X POST http://localhost:8081/sign-orchestrator-info \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json"`}
                </pre>
                <h3 className="text-lg font-bold text-text-primary mt-8 mb-3">Example: Generate Live Payment</h3>
                <pre className="bg-bg-tertiary rounded-xl p-4 text-sm overflow-x-auto">
{`curl -X POST http://localhost:8081/generate-live-payment \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"orchestratorInfo": {...}, "signerState": {...}}'`}
                </pre>
              </div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Create Key Modal ──────────────────────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-bg-primary border border-white/10 rounded-2xl w-full max-w-lg m-4 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-accent-emerald/20 flex items-center justify-center">
                  <Plus size={20} className="text-accent-emerald" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text-primary">Create API Key</h3>
                  <p className="text-xs text-text-secondary">JWT token for remote signer authentication</p>
                </div>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-white/5 rounded-lg">
                <X size={20} className="text-text-secondary" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              {/* Error */}
              {createError && (
                <div className="p-3 bg-accent-rose/10 border border-accent-rose/20 rounded-xl text-sm text-accent-rose flex items-start gap-2">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  {createError}
                </div>
              )}

              {/* Key Name */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Key Name</label>
                <input
                  type="text"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="e.g. Production Gateway, Dev Testing"
                  maxLength={50}
                  className="w-full bg-bg-secondary border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent-emerald transition-colors"
                />
              </div>

              {/* Token Lifetime */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Token Lifetime (TTL)</label>
                <div className="space-y-2">
                  {TTL_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedTTL === opt.value
                          ? 'border-accent-emerald bg-accent-emerald/5'
                          : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      <input
                        type="radio"
                        name="ttl"
                        value={opt.value}
                        checked={selectedTTL === opt.value}
                        onChange={() => setSelectedTTL(opt.value)}
                        className="sr-only"
                      />
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        selectedTTL === opt.value ? 'border-accent-emerald' : 'border-white/30'
                      }`}>
                        {selectedTTL === opt.value && (
                          <div className="w-2 h-2 rounded-full bg-accent-emerald" />
                        )}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-medium text-text-primary">{opt.label}</span>
                        <span className="text-xs text-text-secondary ml-2">{opt.desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Scopes */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Scopes</label>
                <div className="space-y-2">
                  {SCOPE_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedScopes.includes(opt.value)
                          ? 'border-accent-blue bg-accent-blue/5'
                          : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(opt.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedScopes([...selectedScopes, opt.value]);
                          } else {
                            setSelectedScopes(selectedScopes.filter(s => s !== opt.value));
                          }
                        }}
                        className="sr-only"
                      />
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        selectedScopes.includes(opt.value) ? 'border-accent-blue bg-accent-blue' : 'border-white/30'
                      }`}>
                        {selectedScopes.includes(opt.value) && <Check size={12} className="text-white" />}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-medium text-text-primary">{opt.label}</span>
                        <p className="text-xs text-text-secondary">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 p-6 border-t border-white/10">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-3 bg-bg-secondary text-text-secondary rounded-xl hover:bg-bg-tertiary transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateKey}
                disabled={creating || !keyName.trim() || selectedScopes.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-accent-emerald text-white rounded-xl font-bold hover:bg-accent-emerald/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" /></svg>
                    Creating...
                  </span>
                ) : (
                  <>
                    <Key size={16} /> Create Key
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

function getMockModels(): AIModel[] {
  return [
    { id: 'model-sd15', name: 'Stable Diffusion 1.5', tagline: 'Fast, lightweight image generation', type: 'text-to-video', featured: false, realtime: true, costPerMin: { min: 0.02, max: 0.05 }, latencyP50: 120, gatewayCount: 8, badges: ['Realtime'] },
    { id: 'model-sdxl', name: 'SDXL Turbo', tagline: 'High-quality video generation', type: 'text-to-video', featured: true, realtime: true, costPerMin: { min: 0.08, max: 0.15 }, latencyP50: 180, gatewayCount: 12, badges: ['Featured', 'Best Quality'] },
    { id: 'model-krea', name: 'Krea AI', tagline: 'Creative AI for unique visuals', type: 'text-to-video', featured: true, realtime: true, costPerMin: { min: 0.15, max: 0.30 }, latencyP50: 150, gatewayCount: 10, badges: ['Featured', 'Realtime'] },
  ];
}

export default DeveloperView;

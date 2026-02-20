import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Box,
  Key,
  BarChart3,
  BookOpen,
  Plus,
  Trash2,
  Search,
  FolderOpen,
  ChevronDown,
  CreditCard,
  Cloud,
  Loader2,
} from 'lucide-react';
import { Card, Badge, Modal } from '@naap/ui';
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

interface ApiKeyProject {
  id: string;
  name: string;
  isDefault: boolean;
}

interface ApiKey {
  id: string;
  project: ApiKeyProject;
  billingProvider: { id: string; slug: string; displayName: string };
  status: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface BillingProviderInfo {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  authType: string;
}

const BASE_URL = getServiceOrigin('developer-api');

async function fetchCsrfToken(): Promise<string> {
  try {
    const res = await fetch('/api/v1/auth/csrf', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      return data.data?.token || data.token || '';
    }
  } catch (err) {
    console.warn('Failed to fetch CSRF token:', err);
  }
  return '';
}

const tabs = [
  { id: 'api-keys' as TabId, label: 'API Keys', icon: <Key size={18} /> },
  { id: 'usage' as TabId, label: 'Usage & Billing', icon: <BarChart3 size={18} /> },
  { id: 'models' as TabId, label: 'Models', icon: <Box size={18} /> },
  { id: 'docs' as TabId, label: 'Docs', icon: <BookOpen size={18} /> },
];

export const DeveloperView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('api-keys');
  const [models, setModels] = useState<AIModel[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [_loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const [billingProviders, setBillingProviders] = useState<BillingProviderInfo[]>([]);

  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const projectNames = useMemo(() => {
    const names = new Set(apiKeys.map(k => k.project?.name || 'Default'));
    return Array.from(names).sort();
  }, [apiKeys]);

  const keysByProject = useMemo(() => {
    const filtered = projectFilter
      ? apiKeys.filter(k => (k.project?.name || 'Default') === projectFilter)
      : apiKeys;
    const grouped: Record<string, ApiKey[]> = {};
    for (const key of filtered) {
      const name = key.project?.name || 'Default';
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push(key);
    }
    return grouped;
  }, [apiKeys, projectFilter]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [modelsJson, keysJson] = await Promise.all([
        fetch(`${BASE_URL}/api/v1/developer/models`).then(r => r.json()),
        fetch('/api/v1/developer/keys').then(r => r.json()),
      ]);
      setModels((modelsJson.data ?? modelsJson).models || []);
      setApiKeys((keysJson.data ?? keysJson).keys || []);
    } catch (err) {
      console.error('Failed to load data:', err);
      setModels(getMockModels());
      setApiKeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const loadBillingProviders = useCallback(async () => {
    try {
      const json = await fetch('/api/v1/billing-providers').then(r => r.json());
      setBillingProviders((json.data ?? json).providers || []);
    } catch (err) {
      console.error('Failed to load billing providers:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'usage') loadBillingProviders();
  }, [activeTab, loadBillingProviders]);

  const handleRevokeKey = useCallback(async () => {
    if (!revokeKeyId) return;
    setRevoking(true);
    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch(`/api/v1/developer/keys/${revokeKeyId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'include',
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error revoking key:', err);
    } finally {
      setRevoking(false);
      setRevokeKeyId(null);
    }
  }, [revokeKeyId, loadData]);

  const filteredModels = models.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
              className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all ${activeTab === tab.id ? 'text-accent-emerald' : 'text-text-secondary hover:text-text-primary'}`}>
              {tab.icon}{tab.label}
              {activeTab === tab.id && (
                <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-emerald" transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
              )}
            </button>
          ))}
        </nav>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.15 }}>

          {activeTab === 'models' && (
            <div className="space-y-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
                <input type="text" placeholder="Search models..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
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
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <p className="text-text-secondary">{apiKeys.length} API keys</p>
                  {projectNames.length > 1 && (
                    <button onClick={() => setProjectFilter(projectFilter ? null : projectNames[0])}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary border border-white/10 rounded-lg text-text-secondary hover:text-text-primary transition-all">
                      <FolderOpen size={14} />{projectFilter || 'All Projects'}<ChevronDown size={14} />
                    </button>
                  )}
                </div>
                <button disabled
                  className="flex items-center gap-2 px-4 py-2 bg-accent-emerald/50 text-white/70 rounded-xl font-medium cursor-not-allowed"
                  title="API key creation coming soon">
                  <Plus size={16} /> Create Key
                </button>
              </div>
              {Object.entries(keysByProject).map(([pName, keys]) => (
                <div key={pName} className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <FolderOpen size={14} />
                    <span className="font-medium text-text-primary">{pName}</span>
                    <span className="text-xs">({keys.length} key{keys.length !== 1 ? 's' : ''})</span>
                  </div>
                  <Card>
                    <div className="space-y-4">
                      {keys.map((key) => (
                        <div key={key.id} className="flex items-center justify-between p-4 bg-bg-tertiary/50 rounded-xl">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-accent-blue/10 flex items-center justify-center">
                              <Key size={20} className="text-accent-blue" />
                            </div>
                            <div>
                              <p className="font-medium text-text-primary font-mono text-sm">{key.keyPrefix}</p>
                              <p className="text-xs text-text-secondary">
                                Billed via {key.billingProvider?.displayName || 'Unknown'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={key.status === 'ACTIVE' || key.status === 'active' ? 'emerald' : 'rose'}>{key.status}</Badge>
                            <button onClick={() => setRevokeKeyId(key.id)} disabled={key.status === 'REVOKED'}
                              className="p-2 hover:bg-white/5 rounded-lg text-accent-rose disabled:opacity-30 disabled:cursor-not-allowed">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              ))}
              {apiKeys.length === 0 && (
                <Card>
                  <div className="text-center py-8 text-text-secondary">
                    No API keys yet. Create one to get started.
                  </div>
                </Card>
              )}
            </div>
          )}

          {activeTab === 'usage' && (
            <div className="space-y-6">
              <Card>
                <div className="flex items-center gap-3 mb-4">
                  <CreditCard size={20} className="text-accent-emerald" />
                  <div>
                    <h3 className="text-lg font-bold text-text-primary">Billing Providers</h3>
                    <p className="text-sm text-text-secondary">Available billing providers for API key creation</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {billingProviders.length === 0 ? (
                    <div className="text-center py-8 text-text-secondary">
                      <CreditCard size={40} className="mx-auto mb-3 opacity-30" />
                      <p>No billing providers available</p>
                    </div>
                  ) : billingProviders.map((bp) => (
                    <div key={bp.id} className="flex items-center justify-between p-4 rounded-xl border bg-bg-tertiary/50 border-white/10">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/5 text-text-secondary">
                          <Cloud size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-text-primary">{bp.displayName}</p>
                          <p className="text-xs text-text-secondary">{bp.description || bp.slug}</p>
                        </div>
                      </div>
                      <span className="text-xs text-text-secondary capitalize">{bp.authType}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between p-4 rounded-xl border border-dashed border-white/20 bg-bg-tertiary/30">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/5 text-text-secondary">
                        <Plus size={20} />
                      </div>
                      <div>
                        <p className="font-medium text-text-primary">Add your own Billing Provider</p>
                        <p className="text-xs text-text-secondary">Connect a custom billing provider</p>
                      </div>
                    </div>
                    <span className="text-xs text-text-secondary">Coming soon</span>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="text-center py-10">
                  <BarChart3 size={40} className="mx-auto mb-3 text-text-secondary opacity-30" />
                  <h3 className="text-base font-bold text-text-primary mb-1">Usage Dashboard</h3>
                  <p className="text-sm text-text-secondary">Usage tracking and cost breakdown coming soon</p>
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'docs' && (
            <Card>
              <div className="prose prose-invert max-w-none">
                <h2 className="text-xl font-bold text-text-primary mb-4">Getting Started</h2>
                <p className="text-text-secondary mb-4">
                  Welcome to the NAAP Developer API. Follow these steps to integrate:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-text-secondary">
                  <li>Select a model from the Models tab</li>
                  <li>Create an API key for your project</li>
                  <li>Use the API key in your requests</li>
                  <li>Monitor usage in the Usage & Billing tab</li>
                </ol>
              </div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ===== Revoke Confirmation Modal ===== */}
      <Modal isOpen={revokeKeyId !== null} onClose={() => setRevokeKeyId(null)} title="Revoke API Key" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to revoke this API key? This action cannot be undone and any applications using this key will stop working.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setRevokeKeyId(null)} disabled={revoking}
              className="px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors rounded-xl hover:bg-white/5">Cancel</button>
            <button onClick={handleRevokeKey} disabled={revoking}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-all disabled:opacity-50">
              {revoking ? (<><Loader2 size={16} className="animate-spin" /> Revoking...</>) : (<><Trash2 size={16} /> Revoke Key</>)}
            </button>
          </div>
        </div>
      </Modal>
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

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Key, BarChart3, BookOpen, Plus, Copy, RefreshCw, Trash2, Search } from 'lucide-react';
import { Card, Badge } from '@naap/ui';

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
  projectName: string;
  modelName: string;
  gatewayName: string;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const BASE_URL = 'http://localhost:4007';

const tabs = [
  { id: 'models' as TabId, label: 'Models', icon: <Box size={18} /> },
  { id: 'api-keys' as TabId, label: 'API Keys', icon: <Key size={18} /> },
  { id: 'usage' as TabId, label: 'Usage & Billing', icon: <BarChart3 size={18} /> },
  { id: 'docs' as TabId, label: 'Docs', icon: <BookOpen size={18} /> },
];

export const DeveloperView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('models');
  const [models, setModels] = useState<AIModel[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [_loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [modelsRes, keysRes] = await Promise.all([
        fetch(`${BASE_URL}/api/v1/developer/models`).then(r => r.json()),
        fetch(`${BASE_URL}/api/v1/developer/keys`).then(r => r.json()),
      ]);
      setModels(modelsRes.models || []);
      setApiKeys(keysRes.keys || []);
    } catch (err) {
      console.error('Failed to load data:', err);
      setModels(getMockModels());
      setApiKeys(getMockKeys());
    } finally {
      setLoading(false);
    }
  };

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
              className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all ${
                activeTab === tab.id ? 'text-accent-emerald' : 'text-text-secondary hover:text-text-primary'
              }`}>
              {tab.icon}
              {tab.label}
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
              <div className="flex justify-between items-center">
                <p className="text-text-secondary">{apiKeys.length} API keys</p>
                <button className="flex items-center gap-2 px-4 py-2 bg-accent-emerald text-white rounded-xl font-medium hover:bg-accent-emerald/90 transition-all">
                  <Plus size={16} /> Create Key
                </button>
              </div>
              <Card>
                <div className="space-y-4">
                  {apiKeys.map((key) => (
                    <div key={key.id} className="flex items-center justify-between p-4 bg-bg-tertiary/50 rounded-xl">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-accent-blue/10 flex items-center justify-center">
                          <Key size={20} className="text-accent-blue" />
                        </div>
                        <div>
                          <p className="font-medium text-text-primary">{key.projectName}</p>
                          <p className="text-xs text-text-secondary">{key.modelName} • {key.gatewayName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={key.status === 'active' ? 'emerald' : 'rose'}>{key.status}</Badge>
                        <button className="p-2 hover:bg-white/5 rounded-lg"><Copy size={16} /></button>
                        <button className="p-2 hover:bg-white/5 rounded-lg"><RefreshCw size={16} /></button>
                        <button className="p-2 hover:bg-white/5 rounded-lg text-accent-rose"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
                  {apiKeys.length === 0 && (
                    <div className="text-center py-8 text-text-secondary">
                      No API keys yet. Create one to get started.
                    </div>
                  )}
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

function getMockKeys(): ApiKey[] {
  return [
    { id: 'key-1', projectName: 'Production App', modelName: 'SDXL Turbo', gatewayName: 'Gateway Alpha', status: 'active', createdAt: '2024-01-15', lastUsedAt: '2024-01-20' },
    { id: 'key-2', projectName: 'Development', modelName: 'Stable Diffusion 1.5', gatewayName: 'Gateway Beta', status: 'active', createdAt: '2024-01-10', lastUsedAt: null },
  ];
}

export default DeveloperView;

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Key, BarChart3, BookOpen } from 'lucide-react';
import { ModelsTab } from '../components/tabs/ModelsTab';
import { APIKeysTab } from '../components/tabs/APIKeysTab';
import { UsageBillingTab } from '../components/tabs/UsageBillingTab';
import { DocsTab } from '../components/tabs/DocsTab';

type TabId = 'models' | 'api-keys' | 'usage' | 'docs';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const tabs: Tab[] = [
  { id: 'api-keys', label: 'API Keys', icon: <Key size={18} /> },
  { id: 'usage', label: 'Usage & Billing', icon: <BarChart3 size={18} /> },
  { id: 'models', label: 'Models', icon: <Box size={18} /> },
  { id: 'docs', label: 'Docs', icon: <BookOpen size={18} /> },
];

export const DeveloperView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('api-keys');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-outfit font-bold text-text-primary">Developer API Manager</h1>
        <p className="text-text-secondary mt-1">Explore models, manage API keys, and track usage</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-white/10">
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'text-accent-emerald'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.icon}
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-emerald"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'models' && <ModelsTab />}
          {activeTab === 'api-keys' && <APIKeysTab />}
          {activeTab === 'usage' && <UsageBillingTab />}
          {activeTab === 'docs' && <DocsTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default DeveloperView;

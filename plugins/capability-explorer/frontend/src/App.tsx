import React, { useState, useEffect } from 'react';
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { useCapabilities } from './hooks/useCapabilities';
import { useFilters } from './hooks/useFilters';
import { CapabilityGrid } from './components/CapabilityGrid';
import { CapabilityFilters } from './components/CapabilityFilters';
import { CapabilityDetail } from './components/CapabilityDetail';
import { CapabilityStats } from './components/CapabilityStats';
import { DiscoveryPage } from './pages/DiscoveryPage';
import { QueryDetailPage } from './pages/QueryDetailPage';
import { GraphQLPage } from './pages/GraphQLPage';
import { DataSourcesPage } from './pages/DataSourcesPage';
import type { EnrichedCapability, ExplorerStats } from './lib/types';
import { fetchStats } from './lib/api';
import { Layers, Search, Terminal, Database } from 'lucide-react';
import './globals.css';

const TabNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isExplorer = location.pathname === '/' || location.pathname === '/explorer';
  const isDiscovery = location.pathname.startsWith('/queries');
  const isGraphQL = location.pathname === '/graphql';
  const isSources = location.pathname === '/sources';

  const tabs = [
    { path: '/', label: 'Explorer', icon: <Layers size={16} />, active: isExplorer, testId: 'tab-explorer' },
    { path: '/queries', label: 'Discovery', icon: <Search size={16} />, active: isDiscovery, testId: 'tab-discovery' },
    { path: '/graphql', label: 'GraphQL', icon: <Terminal size={16} />, active: isGraphQL, testId: 'tab-graphql' },
    { path: '/sources', label: 'Sources', icon: <Database size={16} />, active: isSources, testId: 'tab-sources' },
  ];

  return (
    <div className="flex items-center gap-1 mb-6 border-b border-[var(--border-color)] pb-0">
      {tabs.map((tab) => (
        <button
          key={tab.path}
          onClick={() => navigate(tab.path)}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab.active
              ? 'border-accent-emerald text-accent-emerald'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
          data-testid={tab.testId}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
};

const ExplorerPage: React.FC = () => {
  const { filters, setCategory, setSearch, setSortBy, toggleSortOrder, setViewMode } = useFilters();
  const { data, loading, error } = useCapabilities({
    category: filters.category,
    search: filters.search,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  });
  const [selectedCapability, setSelectedCapability] = useState<EnrichedCapability | null>(null);
  const [stats, setStats] = useState<ExplorerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  return (
    <>
      <CapabilityStats stats={stats} loading={statsLoading} />

      <CapabilityFilters
        category={filters.category}
        search={filters.search}
        sortBy={filters.sortBy}
        sortOrder={filters.sortOrder}
        viewMode={filters.viewMode}
        onCategoryChange={setCategory}
        onSearchChange={setSearch}
        onSortByChange={setSortBy}
        onSortOrderToggle={toggleSortOrder}
        onViewModeChange={setViewMode}
        total={data?.total ?? 0}
      />

      {error && (
        <div className="glass-card p-4 mb-4 border-accent-rose/30 text-accent-rose text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="loading-skeleton">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-card p-4 animate-pulse">
              <div className="aspect-[16/10] rounded-lg bg-bg-tertiary mb-3" />
              <div className="h-4 bg-bg-tertiary rounded w-3/4 mb-2" />
              <div className="h-3 bg-bg-tertiary rounded w-1/2 mb-3" />
              <div className="h-3 bg-bg-tertiary rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <CapabilityGrid
          capabilities={data?.items ?? []}
          viewMode={filters.viewMode}
          onSelect={setSelectedCapability}
        />
      )}

      {data && !loading && (
        <div className="mt-4 text-center text-xs text-text-muted">
          Showing {data.items.length} of {data.total} capabilities
        </div>
      )}

      {selectedCapability && (
        <CapabilityDetail
          capability={selectedCapability}
          onClose={() => setSelectedCapability(null)}
        />
      )}
    </>
  );
};

const AppRoutes: React.FC = () => (
  <div className="h-full w-full min-h-[600px] p-6">
    <div className="flex items-center gap-3 mb-2">
      <div className="p-2 rounded-lg bg-accent-emerald/10 text-accent-emerald">
        <Layers size={24} />
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Capability Explorer</h1>
        <p className="text-sm text-text-secondary">
          Browse Livepeer network AI capabilities with HuggingFace model metadata
        </p>
      </div>
    </div>

    <TabNav />

    <Routes>
      <Route path="/" element={<ExplorerPage />} />
      <Route path="/explorer" element={<ExplorerPage />} />
      <Route path="/queries" element={<DiscoveryPage />} />
      <Route path="/queries/:id" element={<QueryDetailPage />} />
      <Route path="/graphql" element={<GraphQLPage />} />
      <Route path="/sources" element={<DataSourcesPage />} />
    </Routes>
  </div>
);

export const CapabilityExplorerApp: React.FC = () => (
  <MemoryRouter
    initialEntries={[
      window.location.pathname.replace(/^\/capability-explorer/, '') || '/',
    ]}
  >
    <AppRoutes />
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'capability-explorer',
  version: '1.0.0',
  routes: ['/capability-explorer', '/capability-explorer/*'],
  App: CapabilityExplorerApp,
});

export const mount = plugin.mount;
export default plugin;

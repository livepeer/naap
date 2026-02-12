/**
 * Gallery Page - Dashboard grid view
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Settings, RefreshCw, Plus, Search, AlertCircle } from 'lucide-react';
import { PageHeader, DashboardCard } from '../components';
import { useDashboards } from '../hooks';
import { useAuth } from '@naap/plugin-sdk';
import type { Dashboard } from '../types';

export const GalleryPage: React.FC = () => {
  const navigate = useNavigate();
  const { dashboards, preferences, isLoading, error, refresh, togglePin } = useDashboards();
  const [searchQuery, setSearchQuery] = React.useState('');
  const auth = useAuth();

  // Check if user is admin
  const isAdmin = useMemo(() => {
    return auth?.hasRole?.('my-dashboard:admin') || auth?.hasRole?.('system:admin') || false;
  }, [auth]);

  // Sort dashboards: pinned first, then by order, then by name
  const sortedDashboards = useMemo(() => {
    const filtered = dashboards.filter(d => 
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return filtered.sort((a, b) => {
      const aPinned = preferences.get(a.id)?.pinned || a.isDefault;
      const bPinned = preferences.get(b.id)?.pinned || b.isDefault;
      
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      
      const aOrder = preferences.get(a.id)?.order ?? a.order;
      const bOrder = preferences.get(b.id)?.order ?? b.order;
      
      if (aOrder !== bOrder) return aOrder - bOrder;
      
      return a.name.localeCompare(b.name);
    });
  }, [dashboards, preferences, searchQuery]);

  const pinnedCount = useMemo(() => {
    return dashboards.filter(d => preferences.get(d.id)?.pinned || d.isDefault).length;
  }, [dashboards, preferences]);

  const isPinned = (dashboard: Dashboard) => {
    return preferences.get(dashboard.id)?.pinned || dashboard.isDefault;
  };

  // Empty state for no dashboards
  if (!isLoading && dashboards.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Dashboard"
          subtitle="Your analytics at a glance"
          showBack={false}
          actions={
            <button
              onClick={() => navigate('/settings')}
              className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-secondary transition-colors"
            >
              <Settings className="w-5 h-5 text-text-secondary" />
            </button>
          }
        />

        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-20 h-20 rounded-full dashboard-gradient flex items-center justify-center mb-6">
            <LayoutDashboard className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">
            No Dashboards Available
          </h2>
          <p className="text-text-secondary text-center max-w-md mb-6">
            {isAdmin 
              ? "Configure your Metabase connection and add dashboards to get started."
              : "No dashboards have been configured yet. Contact your administrator."}
          </p>
          {isAdmin && (
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 px-6 py-3 bg-accent-purple text-white rounded-lg font-medium hover:bg-accent-purple/90 transition-colors"
            >
              <Settings className="w-5 h-5" />
              Configure Metabase
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="My Dashboard"
        subtitle={`${dashboards.length} dashboards available${pinnedCount > 0 ? ` · ${pinnedCount} pinned` : ''}`}
        showBack={false}
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-secondary transition-colors"
            >
              <RefreshCw className={`w-5 h-5 text-text-secondary ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            {isAdmin && (
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center gap-2 px-4 py-2 bg-accent-purple text-white rounded-lg font-medium hover:bg-accent-purple/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Dashboard
              </button>
            )}
            <button
              onClick={() => navigate('/settings')}
              className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-secondary transition-colors"
            >
              <Settings className="w-5 h-5 text-text-secondary" />
            </button>
          </div>
        }
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
        <input
          type="text"
          placeholder="Search dashboards..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-bg-secondary border border-white/10 rounded-xl text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-purple/50 transition-colors"
        />
      </div>

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-accent-rose/10 border border-accent-rose/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-accent-rose flex-shrink-0" />
          <div>
            <p className="text-accent-rose font-medium">Failed to load dashboards</p>
            <p className="text-sm text-accent-rose/80">{error}</p>
          </div>
          <button
            onClick={refresh}
            className="ml-auto px-3 py-1.5 bg-accent-rose/20 text-accent-rose rounded-lg hover:bg-accent-rose/30 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && dashboards.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="glass-card p-4 animate-pulse">
              <div className="aspect-video bg-bg-tertiary rounded-lg mb-3" />
              <div className="h-5 bg-bg-tertiary rounded w-3/4 mb-2" />
              <div className="h-4 bg-bg-tertiary rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Dashboard Grid */}
      {!isLoading && sortedDashboards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedDashboards.map(dashboard => (
            <DashboardCard
              key={dashboard.id}
              dashboard={dashboard}
              isPinned={isPinned(dashboard)}
              onTogglePin={togglePin}
            />
          ))}
        </div>
      )}

      {/* No Results */}
      {!isLoading && searchQuery && sortedDashboards.length === 0 && (
        <div className="text-center py-12">
          <Search className="w-12 h-12 text-text-secondary mx-auto mb-4" />
          <p className="text-text-primary font-medium">No dashboards found</p>
          <p className="text-text-secondary">Try a different search term</p>
        </div>
      )}
    </div>
  );
};

export default GalleryPage;

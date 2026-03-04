/**
 * ConnectorListPage — Grid of connector cards with search, filter, and quick-start.
 * Home page of the Service Gateway plugin.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGatewayApi, useAsync } from '../hooks/useGatewayApi';
import { TeamGuard } from '../components/TeamGuard';

interface Connector {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  status: string;
  visibility?: string;
  ownerUserId?: string | null;
  teamId?: string | null;
  category?: string;
  endpointCount: number;
  updatedAt: string;
  tags: string[];
}

interface ConnectorsResponse {
  success: boolean;
  data: Connector[];
  meta?: { total: number };
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  published: 'bg-green-500/10 text-green-400 border-green-500/30',
  archived: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

const VISIBILITY_BADGES: Record<string, { label: string; className: string }> = {
  private: { label: '🔒 Private', className: 'bg-gray-500/10 text-gray-400 border-gray-500/30' },
  team: { label: '👥 Team', className: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  public: { label: '🌐 Public', className: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
};

const CATEGORY_META: Record<string, { label: string; icon: string; color: string }> = {
  ai:        { label: 'AI & ML',     icon: '🤖', color: 'bg-violet-500/10 text-violet-400 border-violet-500/30' },
  video:     { label: 'Video',       icon: '🎬', color: 'bg-pink-500/10 text-pink-400 border-pink-500/30' },
  database:  { label: 'Database',    icon: '🗄️', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  storage:   { label: 'Storage',     icon: '📦', color: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' },
  payments:  { label: 'Payments',    icon: '💳', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  messaging: { label: 'Messaging',   icon: '📡', color: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
  email:     { label: 'Email',       icon: '✉️', color: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
};

const TEMPLATES = [
  { id: 'ai-llm', label: 'AI / LLM', icon: '🤖', desc: 'OpenAI-compatible APIs' },
  { id: 'clickhouse', label: 'ClickHouse', icon: '📊', desc: 'Analytics queries' },
  { id: 'daydream', label: 'Daydream', icon: '🎥', desc: 'AI video generation' },
];

export const ConnectorListPage: React.FC = () => {
  const navigate = useNavigate();
  const api = useGatewayApi();
  const { data, loading, error, execute } = useAsync<ConnectorsResponse>();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  const { get: apiGet } = api;
  const loadConnectors = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (scopeFilter) params.set('scope', scopeFilter);
    return execute(() => apiGet(`/connectors?${params.toString()}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execute, apiGet, statusFilter, scopeFilter]);

  useEffect(() => {
    loadConnectors();
  }, [loadConnectors]);

  const connectors = data?.data || [];

  const categoryCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of connectors) {
      const cat = c.category || '';
      if (cat) counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [connectors]);

  const filtered = connectors.filter((c) => {
    const matchesSearch =
      c.displayName.toLowerCase().includes(search.toLowerCase()) ||
      c.slug.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || c.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <TeamGuard>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">Service Gateway</h1>
            <p className="text-sm text-gray-400 mt-1">Manage your API connectors</p>
          </div>
          <button
            onClick={() => navigate('/new')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + New Connector
          </button>
        </div>

        {/* Scope Tabs */}
        <div className="flex gap-1 border-b border-gray-700 mb-4">
          {([['all', 'All Connectors'], ['own', 'My Connectors'], ['public', 'Public']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setScopeFilter(val)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                scopeFilter === val
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search + Filter */}
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            placeholder="Search connectors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {/* Category Filter Pills */}
        {Object.keys(categoryCounts).length > 0 && (
          <div className="flex gap-2 mb-6 flex-wrap">
            <button
              onClick={() => setCategoryFilter('')}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                !categoryFilter
                  ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'
              }`}
            >
              All ({connectors.length})
            </button>
            {Object.entries(CATEGORY_META).map(([key, meta]) => {
              const count = categoryCounts[key];
              if (!count) return null;
              return (
                <button
                  key={key}
                  onClick={() => setCategoryFilter(categoryFilter === key ? '' : key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    categoryFilter === key
                      ? meta.color
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  {meta.icon} {meta.label} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-lg p-5 animate-pulse">
                <div className="h-5 bg-gray-700 rounded w-3/4 mb-3" />
                <div className="h-4 bg-gray-700 rounded w-1/2 mb-4" />
                <div className="h-3 bg-gray-700 rounded w-1/3" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-200 mb-2">Create your first connector</h2>
            <p className="text-gray-400 text-sm mb-6 max-w-md mx-auto">
              Expose any REST API as a managed, secure endpoint with rate limiting, usage tracking, and auto-generated docs.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(`/new?template=${t.id}`)}
                  className="px-4 py-3 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg text-left transition-colors"
                >
                  <div className="text-lg mb-1">{t.icon}</div>
                  <div className="text-sm font-medium text-gray-200">{t.label}</div>
                  <div className="text-xs text-gray-400">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Connector Grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((connector) => (
              <button
                key={connector.id}
                onClick={() => navigate(`/connectors/${connector.id}`)}
                className="bg-gray-800/50 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg p-5 text-left transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-200 truncate">
                    {connector.displayName}
                  </h3>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded border ${STATUS_COLORS[connector.status] || STATUS_COLORS.draft}`}>
                    {connector.status}
                  </span>
                </div>
                {connector.description && (
                  <p className="text-xs text-gray-400 mb-3 line-clamp-2">{connector.description}</p>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                  {connector.category && CATEGORY_META[connector.category] && (
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${CATEGORY_META[connector.category].color}`}>
                      {CATEGORY_META[connector.category].icon} {CATEGORY_META[connector.category].label}
                    </span>
                  )}
                  <span>{connector.endpointCount} endpoint{connector.endpointCount !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{connector.slug}</span>
                  {connector.visibility && VISIBILITY_BADGES[connector.visibility] && (
                    <>
                      <span>·</span>
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${VISIBILITY_BADGES[connector.visibility].className}`}>
                        {VISIBILITY_BADGES[connector.visibility].label}
                      </span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </TeamGuard>
  );
};

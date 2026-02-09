import React, { useState, useEffect } from 'react';
import { ShoppingBag, Search, Download, Check, Star, Users, Package, ExternalLink, X, Loader2 } from 'lucide-react';
import { Card, Badge } from '@naap/ui';
import { getShellContext } from '../App';

interface PluginPackage {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  category: string;
  author?: string;
  icon?: string;
  downloads: number;
  rating?: number;
  latestVersion?: string;
  installedCount?: number;
  keywords?: string[];
  repository?: string;
  license?: string;
}

interface PluginInstallation {
  id: string;
  packageId: string;
  status: string;
}

const categoryColors: Record<string, 'blue' | 'emerald' | 'amber' | 'rose'> = {
  analytics: 'blue',
  monitoring: 'emerald',
  integration: 'amber',
  tool: 'rose',
  other: 'blue',
};

const BASE_URL = 'http://localhost:4000';

export const MarketplacePage: React.FC = () => {
  const [packages, setPackages] = useState<PluginPackage[]>([]);
  const [installations, setInstallations] = useState<Map<string, PluginInstallation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('downloads');
  const [selectedPackage, setSelectedPackage] = useState<PluginPackage | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPackages();
    loadInstallations();
  }, [searchQuery, categoryFilter, sortBy]);

  const loadPackages = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      params.set('sort', sortBy);

      const response = await fetch(`${BASE_URL}/api/v1/registry/packages?${params}`);
      if (response.ok) {
        const data = await response.json();
        setPackages(data.packages || []);
      } else {
        // Fall back to mock data if registry is empty
        setPackages(getMockPackages());
      }
    } catch (err) {
      console.error('Failed to load packages:', err);
      setPackages(getMockPackages());
    } finally {
      setLoading(false);
    }
  };

  const loadInstallations = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/installations`);
      if (response.ok) {
        const data = await response.json();
        const map = new Map<string, PluginInstallation>();
        (data.installations || []).forEach((inst: PluginInstallation & { package: { name: string } }) => {
          map.set(inst.package.name, inst);
        });
        setInstallations(map);
      }
    } catch (err) {
      console.error('Failed to load installations:', err);
    }
  };

  const handleInstall = async (pkg: PluginPackage) => {
    try {
      setInstalling(pkg.name);
      setError(null);

      const response = await fetch(`${BASE_URL}/api/v1/installations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: pkg.name }),
      });

      if (response.ok) {
        await loadInstallations();
        setSelectedPackage(null);
        
        // Notify shell to refresh plugins
        const shell = getShellContext();
        if (shell?.eventBus) {
          shell.eventBus.emit('plugin:installed', { name: pkg.name });
        }
      } else {
        const data = await response.json();
        setError(data.error || 'Installation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (pkg: PluginPackage) => {
    try {
      setInstalling(pkg.name);
      setError(null);

      const response = await fetch(`${BASE_URL}/api/v1/installations/${pkg.name}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await loadInstallations();
        setSelectedPackage(null);
        
        // Notify shell to refresh plugins
        const shell = getShellContext();
        if (shell?.eventBus) {
          shell.eventBus.emit('plugin:uninstalled', { name: pkg.name });
        }
      } else {
        const data = await response.json();
        setError(data.error || 'Uninstallation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uninstallation failed');
    } finally {
      setInstalling(null);
    }
  };

  const isInstalled = (pkgName: string) => installations.has(pkgName);

  const getIcon = (pkg: PluginPackage) => {
    const icons: Record<string, string> = {
      'gateway-manager': '🌐',
      'orchestrator-manager': '🎭',
      'capacity-planner': '📊',
      'network-analytics': '📈',
      'marketplace': '🛒',
      'community': '👥',
      'developer-api': '💻',
    };
    return icons[pkg.name] || pkg.icon || '📦';
  };

  const categories = ['all', 'analytics', 'monitoring', 'integration', 'tool', 'other'];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Plugin Marketplace</h1>
          <p className="text-text-secondary mt-1">Discover and install plugins to extend your experience</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="blue">{packages.length} plugins available</Badge>
          <Badge variant="emerald">{installations.size} installed</Badge>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-64 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
          <input
            type="text"
            placeholder="Search plugins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-blue transition-colors"
          />
        </div>

        <div className="flex bg-bg-secondary border border-white/10 rounded-xl p-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                categoryFilter === cat 
                  ? 'bg-accent-blue text-white' 
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-bg-secondary border border-white/10 rounded-xl py-2 px-4 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
        >
          <option value="downloads">Most Downloads</option>
          <option value="rating">Highest Rated</option>
          <option value="newest">Newest</option>
          <option value="name">Name A-Z</option>
        </select>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-accent-blue animate-spin" />
        </div>
      ) : (
        <>
          {/* Plugin Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {packages.map((pkg) => (
              <Card
                key={pkg.id || pkg.name}
                className="hover:border-accent-blue/30 transition-all cursor-pointer group relative"
                onClick={() => setSelectedPackage(pkg)}
              >
                {isInstalled(pkg.name) && (
                  <div className="absolute top-3 right-3">
                    <div className="flex items-center gap-1 px-2 py-1 bg-accent-emerald/20 text-accent-emerald rounded-lg text-xs font-medium">
                      <Check size={12} />
                      Installed
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-bg-tertiary flex items-center justify-center text-2xl flex-shrink-0">
                    {getIcon(pkg)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-text-primary group-hover:text-accent-blue transition-colors truncate">
                      {pkg.displayName}
                    </h3>
                    <p className="text-xs text-text-secondary">{pkg.author || 'NAAP Team'}</p>
                  </div>
                </div>

                <p className="text-sm text-text-secondary mb-4 line-clamp-2">
                  {pkg.description || 'A NAAP plugin'}
                </p>

                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Download size={12} />
                      {pkg.downloads || 0}
                    </span>
                    {pkg.rating && (
                      <span className="flex items-center gap-1">
                        <Star size={12} className="text-accent-amber" />
                        {pkg.rating.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <Badge variant={categoryColors[pkg.category] || 'blue'}>
                    {pkg.category}
                  </Badge>
                </div>

                {pkg.keywords && pkg.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {pkg.keywords.slice(0, 3).map((tag) => (
                      <span key={tag} className="px-2 py-0.5 bg-bg-tertiary rounded text-xs text-text-secondary">
                        {tag}
                      </span>
                    ))}
                    {pkg.keywords.length > 3 && (
                      <span className="px-2 py-0.5 text-xs text-text-secondary">
                        +{pkg.keywords.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>

          {/* Empty State */}
          {packages.length === 0 && (
            <Card className="text-center py-16">
              <ShoppingBag size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
              <h3 className="text-lg font-bold text-text-primary mb-2">No plugins found</h3>
              <p className="text-text-secondary">Try adjusting your search or filter criteria</p>
            </Card>
          )}
        </>
      )}

      {/* Plugin Detail Modal */}
      {selectedPackage && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-bg-tertiary flex items-center justify-center text-3xl">
                  {getIcon(selectedPackage)}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-text-primary">{selectedPackage.displayName}</h2>
                  <p className="text-sm text-text-secondary">
                    {selectedPackage.author || 'NAAP Team'} • v{selectedPackage.latestVersion || '1.0.0'}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-text-secondary">
                    <span className="flex items-center gap-1">
                      <Download size={12} />
                      {selectedPackage.downloads || 0} downloads
                    </span>
                    {selectedPackage.rating && (
                      <span className="flex items-center gap-1">
                        <Star size={12} className="text-accent-amber" />
                        {selectedPackage.rating.toFixed(1)}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Users size={12} />
                      {selectedPackage.installedCount || 0} users
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedPackage(null)}
                className="p-2 rounded-lg hover:bg-white/5 text-text-secondary"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-2">Description</h3>
                <p className="text-text-primary">
                  {selectedPackage.description || 'A plugin for the NAAP platform.'}
                </p>
              </div>

              {selectedPackage.keywords && selectedPackage.keywords.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-text-secondary mb-2">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedPackage.keywords.map((tag) => (
                      <span key={tag} className="px-3 py-1 bg-bg-tertiary rounded-lg text-sm text-text-secondary">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-bg-tertiary/50 rounded-xl">
                  <p className="text-xs text-text-secondary mb-1">Category</p>
                  <p className="text-text-primary font-medium capitalize">{selectedPackage.category}</p>
                </div>
                <div className="p-4 bg-bg-tertiary/50 rounded-xl">
                  <p className="text-xs text-text-secondary mb-1">License</p>
                  <p className="text-text-primary font-medium">{selectedPackage.license || 'MIT'}</p>
                </div>
              </div>

              {selectedPackage.repository && (
                <a
                  href={selectedPackage.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-accent-blue hover:underline text-sm"
                >
                  <ExternalLink size={14} />
                  View Repository
                </a>
              )}

              {error && (
                <div className="p-4 bg-accent-rose/10 border border-accent-rose/20 rounded-xl text-accent-rose text-sm">
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 p-6 border-t border-white/10 bg-bg-tertiary/30">
              {isInstalled(selectedPackage.name) ? (
                <>
                  <button
                    onClick={() => handleUninstall(selectedPackage)}
                    disabled={installing === selectedPackage.name}
                    className="flex-1 px-4 py-3 bg-accent-rose/20 text-accent-rose rounded-xl font-medium hover:bg-accent-rose/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {installing === selectedPackage.name ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Uninstalling...
                      </>
                    ) : (
                      'Uninstall'
                    )}
                  </button>
                  <button
                    onClick={() => setSelectedPackage(null)}
                    className="flex-1 px-4 py-3 bg-accent-blue text-white rounded-xl font-bold hover:bg-accent-blue/90 transition-all"
                  >
                    Done
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleInstall(selectedPackage)}
                  disabled={installing === selectedPackage.name}
                  className="w-full px-4 py-3 bg-accent-blue text-white rounded-xl font-bold hover:bg-accent-blue/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {installing === selectedPackage.name ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Installing...
                    </>
                  ) : (
                    <>
                      <Package size={18} />
                      Install Plugin
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Mock data fallback
function getMockPackages(): PluginPackage[] {
  return [
    { id: '1', name: 'gateway-manager', displayName: 'Gateway Manager', description: 'Manage and monitor your AI gateway infrastructure', category: 'monitoring', author: 'NAAP Team', downloads: 1250, rating: 4.8, keywords: ['gateway', 'monitoring', 'infrastructure'] },
    { id: '2', name: 'orchestrator-manager', displayName: 'Orchestrator Manager', description: 'Configure and orchestrate AI pipeline workflows', category: 'tool', author: 'NAAP Team', downloads: 980, rating: 4.6, keywords: ['orchestrator', 'workflow', 'pipelines'] },
    { id: '3', name: 'capacity-planner', displayName: 'Capacity Planner', description: 'Plan and optimize resource capacity across your network', category: 'analytics', author: 'NAAP Team', downloads: 850, rating: 4.5, keywords: ['capacity', 'planning', 'resources'] },
    { id: '4', name: 'network-analytics', displayName: 'Network Analytics', description: 'Deep analytics and insights for your network performance', category: 'analytics', author: 'NAAP Team', downloads: 1100, rating: 4.7, keywords: ['analytics', 'network', 'performance'] },
    { id: '5', name: 'community', displayName: 'Community Hub', description: 'Connect with other operators and share knowledge', category: 'other', author: 'NAAP Team', downloads: 720, rating: 4.4, keywords: ['community', 'social', 'collaboration'] },
    { id: '6', name: 'developer-api', displayName: 'Developer API Manager', description: 'Manage API keys, usage, and developer access', category: 'tool', author: 'NAAP Team', downloads: 650, rating: 4.3, keywords: ['api', 'developer', 'keys'] },
  ];
}

export default MarketplacePage;

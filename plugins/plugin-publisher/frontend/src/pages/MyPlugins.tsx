import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Package, Search, Filter } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { PluginCard } from '../components/PluginCard';
import { listMyPackages, updatePackageStatus, type PluginPackage } from '../lib/api';
import { useNotify } from '@naap/plugin-sdk';

export const MyPlugins: React.FC = () => {
  const notify = useNotify();
  const navigate = useNavigate();
  const [plugins, setPlugins] = React.useState<PluginPackage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  React.useEffect(() => {
    loadPlugins();
  }, []);

  const loadPlugins = async () => {
    try {
      const data = await listMyPackages();
      setPlugins(data);
    } catch (error) {
      console.error('Failed to load plugins:', error);
      notify.error('Failed to load plugins');
    } finally {
      setLoading(false);
    }
  };

  const handleUnpublish = async (name: string) => {
    if (!confirm(`Are you sure you want to unlist ${name}?`)) return;
    
    try {
      await updatePackageStatus(name, 'unlisted');
      notify.success(`${name} has been unlisted`);
      loadPlugins();
    } catch (error) {
      console.error('Failed to unlist plugin:', error);
      notify.error('Failed to unlist plugin');
    }
  };

  const filteredPlugins = plugins
    .filter(p => statusFilter === 'all' || p.publishStatus === statusFilter)
    .filter(p => 
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.displayName || '').toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Plugins"
        subtitle={`${plugins.length} plugins published`}
        actions={
          <button onClick={() => navigate('/new')} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Publish New
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <input
            type="text"
            placeholder="Search plugins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-10"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-text-secondary" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-field w-40"
          >
            <option value="all">All Status</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="unlisted">Unlisted</option>
            <option value="deprecated">Deprecated</option>
          </select>
        </div>
      </div>

      {/* Plugin List */}
      {loading ? (
        <div className="glass-card p-8 text-center">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current text-text-secondary mx-auto"></div>
          <p className="mt-4 text-text-secondary">Loading plugins...</p>
        </div>
      ) : filteredPlugins.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Package className="w-8 h-8 text-text-secondary mx-auto mb-4" />
          <h3 className="text-sm font-semibold text-text-primary mb-2">
            {search || statusFilter !== 'all' ? 'No plugins found' : 'No plugins yet'}
          </h3>
          <p className="text-text-secondary mb-4">
            {search || statusFilter !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'Publish your first plugin to the NAAP marketplace.'}
          </p>
          {!search && statusFilter === 'all' && (
            <button onClick={() => navigate('/new')} className="btn-primary">
              Publish Plugin
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filteredPlugins.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} onUnpublish={handleUnpublish} />
          ))}
        </div>
      )}
    </div>
  );
};

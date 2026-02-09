import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Package, Key, Settings, TrendingUp, Download } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { LucideIcon } from '../components/LucideIcon';
import { listMyPackages, type PluginPackage } from '../lib/api';
import { useNotify } from '@naap/plugin-sdk';

export const Dashboard: React.FC = () => {
  const notify = useNotify();
  const navigate = useNavigate();
  const [plugins, setPlugins] = React.useState<PluginPackage[]>([]);
  const [loading, setLoading] = React.useState(true);

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

  const totalDownloads = plugins.reduce((sum, p) => sum + p.downloads, 0);
  const publishedCount = plugins.filter(p => p.publishStatus === 'published').length;

  const quickActions = [
    { icon: Upload, label: 'Publish New Plugin', path: '/new', color: 'bg-accent-emerald' },
    { icon: Package, label: 'My Plugins', path: '/plugins', color: 'bg-accent-blue' },
    { icon: Key, label: 'API Tokens', path: '/tokens', color: 'bg-accent-purple' },
    { icon: Settings, label: 'Settings', path: '/settings', color: 'bg-accent-amber' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plugin Publisher"
        subtitle="Publish and manage your plugins in the NAAP marketplace"
        showBack={false}
      />

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-text-secondary text-sm">Total Plugins</p>
              <p className="text-3xl font-bold text-text-primary mt-1">{plugins.length}</p>
            </div>
            <div className="p-3 bg-accent-blue/20 rounded-xl">
              <Package className="w-6 h-6 text-accent-blue" />
            </div>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-text-secondary text-sm">Published</p>
              <p className="text-3xl font-bold text-text-primary mt-1">{publishedCount}</p>
            </div>
            <div className="p-3 bg-accent-emerald/20 rounded-xl">
              <TrendingUp className="w-6 h-6 text-accent-emerald" />
            </div>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-text-secondary text-sm">Total Downloads</p>
              <p className="text-3xl font-bold text-text-primary mt-1">
                {totalDownloads.toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-accent-purple/20 rounded-xl">
              <Download className="w-6 h-6 text-accent-purple" />
            </div>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-text-secondary text-sm">Avg Rating</p>
              <p className="text-3xl font-bold text-text-primary mt-1">
                {plugins.length > 0
                  ? (plugins.reduce((sum, p) => sum + (p.rating || 0), 0) / plugins.length).toFixed(1)
                  : '-'}
              </p>
            </div>
            <div className="p-3 bg-accent-amber/20 rounded-xl">
              <TrendingUp className="w-6 h-6 text-accent-amber" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Quick Actions</h2>
        <div className="grid grid-cols-4 gap-4">
          {quickActions.map((action) => (
            <button
              key={action.path}
              onClick={() => navigate(action.path)}
              className="glass-card p-5 hover:border-accent-emerald/30 transition-all text-left group"
            >
              <div className={`p-3 ${action.color}/20 rounded-xl w-fit group-hover:scale-110 transition-transform`}>
                <action.icon className={`w-6 h-6 ${action.color.replace('bg-', 'text-')}`} />
              </div>
              <p className="mt-3 font-medium text-text-primary">{action.label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Plugins */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Recent Plugins</h2>
          <button
            onClick={() => navigate('/plugins')}
            className="text-sm text-accent-emerald hover:underline"
          >
            View All
          </button>
        </div>

        {loading ? (
          <div className="glass-card p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-emerald mx-auto"></div>
            <p className="mt-4 text-text-secondary">Loading plugins...</p>
          </div>
        ) : plugins.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <Package className="w-12 h-12 text-text-secondary mx-auto mb-4" />
            <h3 className="text-lg font-medium text-text-primary mb-2">No plugins yet</h3>
            <p className="text-text-secondary mb-4">
              Publish your first plugin to the NAAP marketplace.
            </p>
            <button onClick={() => navigate('/new')} className="btn-primary">
              Publish Plugin
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {plugins.slice(0, 4).map((plugin) => (
              <div
                key={plugin.id}
                onClick={() => navigate(`/plugins/${plugin.name}`)}
                className="glass-card p-4 hover:border-accent-emerald/30 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-bg-tertiary rounded-lg">
                    <LucideIcon name={plugin.icon || 'Package'} className="w-5 h-5 text-accent-emerald" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-text-primary truncate">{plugin.displayName || plugin.name}</h4>
                    <p className="text-sm text-text-secondary">{(plugin.downloads ?? 0).toLocaleString()} downloads</p>
                  </div>
                  <span
                    className={`badge ${
                      plugin.publishStatus === 'published' ? 'badge-success' 
                      : plugin.publishStatus === 'deprecated' ? 'badge-error'
                      : plugin.publishStatus === 'unlisted' ? 'badge-warning'
                      : 'badge-info'
                    }`}
                  >
                    {plugin.publishStatus === 'published' ? 'Published' 
                      : plugin.publishStatus === 'deprecated' ? 'Deprecated'
                      : plugin.publishStatus === 'unlisted' ? 'Unlisted'
                      : 'Draft'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

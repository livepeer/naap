import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Download, Star, Tag, Trash2, Eye, EyeOff, Package } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { StatsChart } from '../components/StatsChart';
import { LucideIcon } from '../components/LucideIcon';
import { getPackage, getPluginStats, updatePackageStatus, type PluginPackage, type PluginStats } from '../lib/api';
import { useNotify } from '@naap/plugin-sdk';

export const PluginDetail: React.FC = () => {
  const notify = useNotify();
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const [plugin, setPlugin] = React.useState<PluginPackage | null>(null);
  const [stats, setStats] = React.useState<PluginStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [statsLoading, setStatsLoading] = React.useState(true);

  React.useEffect(() => {
    if (name) {
      loadPlugin(name);
      loadStats(name);
    }
  }, [name]);

  const loadPlugin = async (packageName: string) => {
    try {
      const data = await getPackage(packageName);
      setPlugin(data);
    } catch (error) {
      console.error('Failed to load plugin:', error);
      notify.error('Failed to load plugin');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (packageName: string) => {
    try {
      const data = await getPluginStats(packageName);
      setStats(data);
    } catch (error) {
      console.warn('Stats unavailable:', error);
      // Set empty stats so UI doesn't get stuck loading
      setStats({ totalDownloads: 0, totalInstalls: 0, versionsCount: 0, timeline: [] });
    } finally {
      setStatsLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: 'published' | 'unlisted' | 'deprecated') => {
    if (!plugin) return;
    
    const confirmMsg = {
      published: 'Are you sure you want to republish this plugin?',
      unlisted: 'Are you sure you want to unlist this plugin? It will no longer appear in search.',
      deprecated: 'Are you sure you want to deprecate this plugin? This signals it is no longer maintained.',
    }[newStatus];

    if (!confirm(confirmMsg)) return;

    try {
      await updatePackageStatus(plugin.name, newStatus);
      notify.success(`Plugin status updated to ${newStatus}`);
      loadPlugin(plugin.name);
    } catch (error) {
      console.error('Failed to update status:', error);
      notify.error('Failed to update status');
    }
  };

  const getStatusBadge = () => {
    if (!plugin) return null;
    switch (plugin.publishStatus) {
      case 'published':
        return <span className="badge badge-success">Published</span>;
      case 'unlisted':
        return <span className="badge badge-warning">Unlisted</span>;
      case 'deprecated':
        return <span className="badge badge-error">Deprecated</span>;
      default:
        return <span className="badge badge-info">Draft</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current text-text-secondary"></div>
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="glass-card p-8 text-center">
        <Package className="w-8 h-8 text-text-secondary mx-auto mb-4" />
        <h3 className="text-sm font-semibold text-text-primary mb-2">Plugin Not Found</h3>
        <button onClick={() => navigate('/plugins')} className="btn-primary mt-4">
          Back to Plugins
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={plugin.displayName}
        subtitle={plugin.name}
        backTo="/plugins"
        actions={
          <div className="flex items-center gap-2">
            {plugin.publishStatus !== 'published' && (
              <button
                onClick={() => handleStatusChange('published')}
                className="btn-secondary flex items-center gap-2"
              >
                <Eye className="w-4 h-4" />
                Publish
              </button>
            )}
            {plugin.publishStatus === 'published' && (
              <button
                onClick={() => handleStatusChange('unlisted')}
                className="btn-secondary flex items-center gap-2"
              >
                <EyeOff className="w-4 h-4" />
                Unlist
              </button>
            )}
            <button
              onClick={() => handleStatusChange('deprecated')}
              className="btn-secondary flex items-center gap-2 text-accent-rose"
            >
              <Trash2 className="w-4 h-4" />
              Deprecate
            </button>
          </div>
        }
      />

      {/* Plugin Info */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          {/* Description */}
          <div className="glass-card p-4">
            <div className="flex items-start gap-4">
              <div className="p-2.5 bg-bg-tertiary rounded-lg">
                <LucideIcon name={plugin.icon || 'Package'} className="w-5 h-5 text-accent-emerald" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-base font-semibold text-text-primary">{plugin.displayName}</h2>
                  {getStatusBadge()}
                </div>
                <p className="text-text-secondary">
                  {plugin.description || 'No description available'}
                </p>
                <div className="flex items-center gap-4 mt-4 text-sm text-text-secondary">
                  <div className="flex items-center gap-1">
                    <Download className="w-4 h-4" />
                    <span>{(plugin.downloads ?? 0).toLocaleString()} downloads</span>
                  </div>
                  {plugin.rating != null && (
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 text-accent-amber" />
                      <span>{plugin.rating.toFixed(1)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Tag className="w-4 h-4" />
                    <span>{plugin.category || 'Uncategorized'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Statistics</h3>
            <StatsChart stats={stats} loading={statsLoading} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Metadata */}
          <div className="glass-card p-4">
            <h3 className="font-medium text-text-primary mb-3">Details</h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-text-secondary">Author</dt>
                <dd className="text-text-primary">{plugin.author || 'Unknown'}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Category</dt>
                <dd className="text-text-primary capitalize">{plugin.category}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Created</dt>
                <dd className="text-text-primary">
                  {new Date(plugin.createdAt).toLocaleDateString()}
                </dd>
              </div>
              <div>
                <dt className="text-text-secondary">Updated</dt>
                <dd className="text-text-primary">
                  {new Date(plugin.updatedAt).toLocaleDateString()}
                </dd>
              </div>
            </dl>
          </div>

          {/* Versions */}
          <div className="glass-card p-4">
            <h3 className="font-medium text-text-primary mb-3">Versions</h3>
            {plugin.versions && plugin.versions.length > 0 ? (
              <ul className="space-y-2">
                {plugin.versions.slice(0, 5).map((version) => (
                  <li key={version.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-text-secondary" />
                      <span className="text-text-primary font-mono">{version.version}</span>
                    </div>
                    <span className="text-text-secondary">
                      {new Date(version.publishedAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-secondary">No versions published yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

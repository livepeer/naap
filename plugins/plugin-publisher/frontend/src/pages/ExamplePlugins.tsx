import React from 'react';
import { Blocks, CheckCircle, AlertCircle, Upload, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { LucideIcon } from '../components/LucideIcon';
import {
  listExamplePlugins,
  publishExamplePlugin,
  type ExamplePlugin,
} from '../lib/api';
import { useNotify } from '@naap/plugin-sdk';

type PublishState = 'idle' | 'publishing' | 'published' | 'error';

interface PluginCardState {
  plugin: ExamplePlugin;
  publishState: PublishState;
  error?: string;
}

export const ExamplePlugins: React.FC = () => {
  const notify = useNotify();
  const [cards, setCards] = React.useState<PluginCardState[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [featureDisabled, setFeatureDisabled] = React.useState(false);

  const loadExamples = React.useCallback(async () => {
    setLoading(true);
    setFeatureDisabled(false);
    try {
      const examples = await listExamplePlugins();
      setCards(
        examples.map((p) => ({
          plugin: p,
          publishState: p.alreadyPublished ? 'published' : 'idle',
        })),
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'status' in err && (err as any).status === 403) {
        setFeatureDisabled(true);
      } else {
        notify.error('Failed to load example plugins');
      }
    } finally {
      setLoading(false);
    }
  }, [notify]);

  React.useEffect(() => {
    loadExamples();
  }, [loadExamples]);

  const handlePublish = async (name: string) => {
    setCards((prev) =>
      prev.map((c) =>
        c.plugin.name === name ? { ...c, publishState: 'publishing', error: undefined } : c,
      ),
    );

    try {
      await publishExamplePlugin(name);
      setCards((prev) =>
        prev.map((c) =>
          c.plugin.name === name
            ? { ...c, publishState: 'published', plugin: { ...c.plugin, alreadyPublished: true } }
            : c,
        ),
      );
      notify.success(`Published "${name}" to marketplace`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Publish failed';
      setCards((prev) =>
        prev.map((c) =>
          c.plugin.name === name ? { ...c, publishState: 'error', error: message } : c,
        ),
      );
      notify.error(message);
    }
  };

  if (featureDisabled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Example Plugins"
          subtitle="Browse and publish bundled example plugins"
        />
        <div className="glass-card p-12 text-center">
          <AlertCircle className="w-12 h-12 text-text-secondary mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">Feature Not Enabled</h3>
          <p className="text-text-secondary max-w-md mx-auto">
            Example plugin publishing is currently disabled. Ask your platform administrator to
            enable the <code className="text-accent-emerald">enableExamplePublishing</code> feature
            flag.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Example Plugins"
        subtitle="Browse and publish bundled example plugins to the marketplace"
        actions={
          <button
            onClick={loadExamples}
            disabled={loading}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {loading ? (
        <div className="glass-card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-emerald mx-auto" />
          <p className="mt-4 text-text-secondary">Discovering example plugins...</p>
        </div>
      ) : cards.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Blocks className="w-12 h-12 text-text-secondary mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Example Plugins Found</h3>
          <p className="text-text-secondary">
            No example plugins were found in the <code>examples/</code> directory.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map(({ plugin, publishState, error }) => (
            <div
              key={plugin.name}
              className="glass-card p-5 flex flex-col gap-3 transition-all hover:border-accent-emerald/30"
            >
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-bg-tertiary rounded-xl shrink-0">
                  <LucideIcon
                    name={plugin.icon || 'Blocks'}
                    className="w-6 h-6 text-accent-emerald"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-text-primary truncate">
                    {plugin.displayName}
                  </h3>
                  <span className="badge badge-info text-xs">{plugin.category}</span>
                </div>
              </div>

              <p className="text-sm text-text-secondary line-clamp-2 min-h-[2.5rem]">
                {plugin.description || 'No description available.'}
              </p>

              <div className="flex items-center justify-between text-xs text-text-secondary mt-auto pt-2 border-t border-border-primary">
                <span>{plugin.author}</span>
                <span>v{plugin.version}</span>
              </div>

              {publishState === 'published' ? (
                <button disabled className="btn-secondary w-full flex items-center justify-center gap-2 opacity-70 cursor-default">
                  <CheckCircle className="w-4 h-4 text-accent-emerald" />
                  Published
                </button>
              ) : publishState === 'publishing' ? (
                <button disabled className="btn-primary w-full flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Publishing...
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handlePublish(plugin.name)}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Publish to Marketplace
                  </button>
                  {publishState === 'error' && error && (
                    <p className="text-xs text-red-400 mt-1">{error}</p>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

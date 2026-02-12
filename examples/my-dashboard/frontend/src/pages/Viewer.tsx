/**
 * Viewer Page - Full-screen Metabase dashboard embed
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import { PageHeader, MetabaseEmbed } from '../components';
import { useMetabaseEmbed, useDashboards } from '../hooks';
import { useEvents, useNotify } from '@naap/plugin-sdk';

export const ViewerPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { embedUrl, isLoading, error, refresh } = useMetabaseEmbed(id || '');
  const { dashboards } = useDashboards();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const events = useEvents();
  const notify = useNotify();

  // Find the dashboard info
  const dashboard = useMemo(() => {
    return dashboards.find(d => d.id === id);
  }, [dashboards, id]);

  // Handle fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Notify shell of dashboard load
  useEffect(() => {
    if (dashboard && events?.emit) {
      events.emit('dashboard:viewed', {
        id: dashboard.id,
        name: dashboard.name,
      });
    }
  }, [dashboard, events]);

  // Handle embed load success
  const handleLoad = () => {
    if (events?.emit) {
      events.emit('dashboard:loaded', { id });
    }
  };

  // Handle embed error
  const handleError = (errorMsg: string) => {
    notify?.error?.(errorMsg);
  };

  // No dashboard found
  if (!id) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" subtitle="View your analytics" />
        <div className="flex flex-col items-center justify-center py-20">
          <AlertCircle className="w-12 h-12 text-accent-amber mb-4" />
          <p className="text-text-primary font-medium">No dashboard selected</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-accent-purple text-white rounded-lg"
          >
            Go to Gallery
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${isFullscreen ? 'fixed inset-0 z-50 bg-bg-primary p-4' : ''}`}>
      {/* Header */}
      <PageHeader
        title={dashboard?.name || 'Dashboard'}
        subtitle={dashboard?.description}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-secondary transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 text-text-secondary ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-secondary transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-5 h-5 text-text-secondary" />
              ) : (
                <Maximize2 className="w-5 h-5 text-text-secondary" />
              )}
            </button>

            {embedUrl && (
              <a
                href={embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-secondary transition-colors"
                title="Open in new tab"
              >
                <ExternalLink className="w-5 h-5 text-text-secondary" />
              </a>
            )}
          </div>
        }
      />

      {/* Embed Container */}
      <div className={`glass-card overflow-hidden ${isFullscreen ? 'flex-1' : ''}`} style={{ height: isFullscreen ? 'calc(100vh - 120px)' : 'calc(100vh - 200px)' }}>
        {isLoading && !embedUrl ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-accent-purple animate-spin mx-auto" />
              <p className="text-text-secondary">Loading dashboard...</p>
            </div>
          </div>
        ) : error ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-4 max-w-md">
              <AlertCircle className="w-12 h-12 text-accent-rose mx-auto" />
              <div>
                <p className="text-text-primary font-medium">Failed to load dashboard</p>
                <p className="text-sm text-text-secondary mt-1">{error}</p>
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={refresh}
                  className="px-4 py-2 bg-accent-purple text-white rounded-lg hover:bg-accent-purple/90 transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => navigate('/')}
                  className="px-4 py-2 bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-secondary transition-colors"
                >
                  Back to Gallery
                </button>
              </div>
            </div>
          </div>
        ) : (
          <MetabaseEmbed
            embedUrl={embedUrl || ''}
            title={dashboard?.name}
            className="w-full h-full"
            onLoad={handleLoad}
            onError={handleError}
          />
        )}
      </div>
    </div>
  );
};

export default ViewerPage;

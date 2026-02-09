/**
 * MetabaseEmbed - Iframe component for Metabase dashboard embedding
 */

import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface MetabaseEmbedProps {
  embedUrl: string;
  title?: string;
  className?: string;
  onLoad?: () => void;
  onError?: (error: string) => void;
}

export const MetabaseEmbed: React.FC<MetabaseEmbedProps> = ({
  embedUrl,
  title = 'Dashboard',
  className = '',
  onLoad,
  onError,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // Reset state when URL changes
    setIsLoading(true);
    setError(null);
  }, [embedUrl]);

  const handleLoad = () => {
    setIsLoading(false);
    onLoad?.();
  };

  const handleError = () => {
    setIsLoading(false);
    const errorMsg = 'Failed to load dashboard. Please check your Metabase configuration.';
    setError(errorMsg);
    onError?.(errorMsg);
  };

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    setIsLoading(true);
    setError(null);
  };

  if (!embedUrl) {
    return (
      <div className={`flex items-center justify-center bg-bg-secondary rounded-lg p-8 ${className}`}>
        <div className="text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-accent-amber mx-auto" />
          <p className="text-text-secondary">No embed URL provided</p>
          <p className="text-sm text-text-secondary">
            Configure your Metabase connection in settings
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-bg-secondary rounded-lg p-8 ${className}`}>
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-accent-rose mx-auto" />
          <p className="text-text-primary font-medium">{error}</p>
          <button
            onClick={handleRetry}
            className="flex items-center gap-2 px-4 py-2 bg-accent-purple text-white rounded-lg hover:bg-accent-purple/90 transition-colors mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`metabase-embed relative ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary rounded-lg">
          <div className="text-center space-y-3">
            <Loader2 className="w-8 h-8 text-accent-purple animate-spin mx-auto" />
            <p className="text-text-secondary">Loading dashboard...</p>
          </div>
        </div>
      )}
      
      <iframe
        key={`${embedUrl}-${retryCount}`}
        src={embedUrl}
        title={title}
        onLoad={handleLoad}
        onError={handleError}
        className={`w-full h-full border-0 rounded-lg ${isLoading ? 'invisible' : ''}`}
        allow="fullscreen"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
};

export default MetabaseEmbed;

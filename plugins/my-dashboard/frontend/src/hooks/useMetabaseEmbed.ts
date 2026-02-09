/**
 * useMetabaseEmbed - Hook for fetching embed URLs
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl, getAuthHeaders } from '../App';
import type { EmbedResponse, ApiResponse } from '../types';

interface UseMetabaseEmbedReturn {
  embedUrl: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMetabaseEmbed(dashboardId: string): UseMetabaseEmbedReturn {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEmbedUrl = useCallback(async () => {
    if (!dashboardId) {
      setError('No dashboard ID provided');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/embed/${dashboardId}`, {
        headers: await getAuthHeaders(),
      });

      if (!res.ok) {
        throw new Error('Failed to get embed URL');
      }

      const data: ApiResponse<EmbedResponse> = await res.json();
      
      if (data.success && data.data?.embedUrl) {
        setEmbedUrl(data.data.embedUrl);
      } else {
        throw new Error(data.error?.message || 'Invalid response');
      }
    } catch (err) {
      console.error('Failed to fetch embed URL:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => {
    fetchEmbedUrl();
  }, [fetchEmbedUrl]);

  return {
    embedUrl,
    isLoading,
    error,
    refresh: fetchEmbedUrl,
  };
}

export default useMetabaseEmbed;

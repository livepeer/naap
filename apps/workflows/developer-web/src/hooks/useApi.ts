import { useState, useCallback } from 'react';
import type { AIModel, DeveloperApiKey, UsageRecord } from '@naap/types';
import { getServiceOrigin } from '@naap/plugin-sdk';

const API_BASE = `${getServiceOrigin('developer-api')}/api/v1/developer`;

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Generic fetch hook
export function useApiCall<T>() {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(async (url: string, options?: RequestInit): Promise<T | null> => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch(`${API_BASE}${url}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        ...options,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'API request failed');
      }

      const data = await response.json();
      setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      setState((prev) => ({ ...prev, loading: false, error }));
      return null;
    }
  }, []);

  return { ...state, execute };
}

// Models API
export function useModels() {
  const { data, loading, error, execute } = useApiCall<{ models: AIModel[]; total: number }>();

  const fetchModels = useCallback(
    (filters?: { type?: string; featured?: boolean; realtime?: boolean }) => {
      const params = new URLSearchParams();
      if (filters?.type) params.set('type', filters.type);
      if (filters?.featured) params.set('featured', 'true');
      if (filters?.realtime) params.set('realtime', 'true');

      const query = params.toString();
      return execute(`/models${query ? `?${query}` : ''}`);
    },
    [execute]
  );

  return { models: data?.models || [], total: data?.total || 0, loading, error, fetchModels };
}

export function useModel(modelId: string) {
  const { data, loading, error, execute } = useApiCall<AIModel>();

  const fetchModel = useCallback(() => {
    return execute(`/models/${modelId}`);
  }, [execute, modelId]);

  return { model: data, loading, error, fetchModel };
}

// API Keys API
export function useApiKeys() {
  const { data, loading, error, execute } = useApiCall<{ keys: DeveloperApiKey[]; total: number }>();

  const fetchKeys = useCallback(() => {
    return execute('/keys');
  }, [execute]);

  const rotateKey = useCallback(async (keyId: string) => {
    const response = await fetch(`${API_BASE}/keys/${keyId}/rotate`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to rotate key');
    }
    return response.json();
  }, []);

  const renameKey = useCallback(async (keyId: string, projectName: string) => {
    const response = await fetch(`${API_BASE}/keys/${keyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to rename key');
    }
    return response.json();
  }, []);

  const revokeKey = useCallback(async (keyId: string) => {
    const response = await fetch(`${API_BASE}/keys/${keyId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to revoke key');
    }
    return response.json();
  }, []);

  return {
    keys: data?.keys || [],
    total: data?.total || 0,
    loading,
    error,
    fetchKeys,
    rotateKey,
    renameKey,
    revokeKey,
  };
}

// Usage API
export function useUsage(keyId?: string) {
  const { data, loading, error, execute } = useApiCall<{
    records: { date: string; sessions: number; outputMinutes: number; estimatedCost: number }[];
    totals: { sessions: number; outputMinutes: number; estimatedCost: number };
  }>();

  const fetchUsage = useCallback(
    (days: number = 7) => {
      const params = new URLSearchParams();
      params.set('days', days.toString());
      if (keyId) params.set('keyId', keyId);

      return execute(`/usage?${params.toString()}`);
    },
    [execute, keyId]
  );

  return {
    records: data?.records || [],
    totals: data?.totals || { sessions: 0, outputMinutes: 0, estimatedCost: 0 },
    loading,
    error,
    fetchUsage,
  };
}

export function useKeyUsage(keyId: string) {
  const { data, loading, error, execute } = useApiCall<{
    keyId: string;
    records: UsageRecord[];
    totals: { sessions: number; outputMinutes: number; estimatedCost: number };
  }>();

  const fetchUsage = useCallback(
    (days: number = 7) => {
      return execute(`/keys/${keyId}/usage?days=${days}`);
    },
    [execute, keyId]
  );

  return {
    records: data?.records || [],
    totals: data?.totals || { sessions: 0, outputMinutes: 0, estimatedCost: 0 },
    loading,
    error,
    fetchUsage,
  };
}

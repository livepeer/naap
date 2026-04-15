import { useState, useEffect, useCallback } from 'react';
import type { CapabilityConnection, CapabilityCategory, SortField, SortOrder } from '../lib/types';
import { fetchCapabilities } from '../lib/api';

interface UseCapabilitiesOptions {
  category?: CapabilityCategory;
  search?: string;
  sortBy?: SortField;
  sortOrder?: SortOrder;
  limit?: number;
}

export function useCapabilities(opts: UseCapabilitiesOptions = {}) {
  const [data, setData] = useState<CapabilityConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCapabilities({
        category: opts.category,
        search: opts.search,
        sortBy: opts.sortBy,
        sortOrder: opts.sortOrder,
        limit: opts.limit ?? 50,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load capabilities');
    } finally {
      setLoading(false);
    }
  }, [opts.category, opts.search, opts.sortBy, opts.sortOrder, opts.limit]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

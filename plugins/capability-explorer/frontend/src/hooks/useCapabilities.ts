import { useState, useEffect, useCallback, useRef } from 'react';
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
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
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
      if (requestId === requestIdRef.current) {
        setData(result);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load capabilities');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [opts.category, opts.search, opts.sortBy, opts.sortOrder, opts.limit]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

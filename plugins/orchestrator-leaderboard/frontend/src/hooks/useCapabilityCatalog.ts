import { useEffect, useState } from 'react';
import {
  fetchCapabilityCatalog,
  type CapabilityCatalogResponse,
  type CapabilityCatalogPipeline,
} from '../lib/api';

type BillingProviderSlug = 'pymthouse' | 'daydream';

export function useCapabilityCatalog(billingProviderSlug: BillingProviderSlug) {
  const [pipelines, setPipelines] = useState<CapabilityCatalogPipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<CapabilityCatalogResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const data = await fetchCapabilityCatalog(billingProviderSlug);
        if (!cancelled) {
          setPipelines(data.pipelines);
          setMeta(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load capability catalog');
          setPipelines([]);
          setMeta(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [billingProviderSlug]);

  return { pipelines, loading, error, meta };
}

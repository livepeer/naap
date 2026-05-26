import { useEffect, useState } from 'react';
import {
  fetchCapabilityCatalog,
  fetchCapabilityCatalogManifest,
  type CapabilityCatalogResponse,
  type CapabilityCatalogPipeline,
} from '../lib/api';

// Only Daydream is supported right now; extend this union when PymtHouse is added.
type BillingProviderSlug = 'daydream';

export function useCapabilityCatalog(
  billingProviderSlug: BillingProviderSlug,
  capabilitiesToValidate: string[] = [],
) {
  const [pipelines, setPipelines] = useState<CapabilityCatalogPipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<CapabilityCatalogResponse | null>(null);
  const [manifestMeta, setManifestMeta] = useState<CapabilityCatalogResponse | null>(null);
  const [manifestFilteredCapabilities, setManifestFilteredCapabilities] = useState<string[] | null>(null);

  const capabilitiesKey = capabilitiesToValidate.join('\n');

  useEffect(() => {
    let cancelled = false;
    setManifestMeta(null);
    setManifestFilteredCapabilities(null);

    async function loadManifest() {
      const capabilitiesToCheck = capabilitiesKey ? capabilitiesKey.split('\n') : [];
      if (billingProviderSlug !== 'pymthouse' || capabilitiesToCheck.length === 0) {
        return;
      }

      try {
        const data = await fetchCapabilityCatalogManifest(billingProviderSlug, capabilitiesToCheck);
        if (!cancelled) {
          setManifestMeta(data);
          setManifestFilteredCapabilities(data.filteredCapabilities ?? capabilitiesToCheck);
        }
      } catch {
        if (!cancelled) {
          setManifestMeta(null);
          setManifestFilteredCapabilities(null);
        }
      }
    }

    loadManifest();
    return () => {
      cancelled = true;
    };
  }, [billingProviderSlug, capabilitiesKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPipelines([]);
    setMeta(null);

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

  return { pipelines, loading, error, meta, manifestMeta, manifestFilteredCapabilities };
}

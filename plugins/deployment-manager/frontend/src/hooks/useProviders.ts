import { useState, useEffect } from 'react';

const API_BASE = '/api/v1/deployment-manager';

export interface Provider {
  slug: string;
  displayName: string;
  description: string;
  icon: string;
  mode: 'serverless' | 'ssh-bridge';
  connectorSlug: string;
  authMethod: string;
}

export interface GpuOption {
  id: string;
  name: string;
  vramGb: number;
  cudaVersion?: string;
  available: boolean;
  pricePerHour?: number;
}

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/providers`)
      .then((res) => res.json())
      .then((data) => { if (data.success) setProviders(data.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { providers, loading };
}

export function useGpuOptions(providerSlug: string | null) {
  const [gpuOptions, setGpuOptions] = useState<GpuOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!providerSlug) { setGpuOptions([]); return; }
    setLoading(true);
    fetch(`${API_BASE}/providers/${providerSlug}/gpu-options`)
      .then((res) => res.json())
      .then((data) => { if (data.success) setGpuOptions(data.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [providerSlug]);

  return { gpuOptions, loading };
}

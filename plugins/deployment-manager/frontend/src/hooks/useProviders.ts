import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/apiFetch';

export interface Provider {
  slug: string;
  displayName: string;
  description: string;
  icon: string;
  mode: 'serverless' | 'ssh-bridge';
  authMethod: string;
  secretNames?: string[];
}

export interface GpuOption {
  id: string;
  name: string;
  vramGb: number;
  cudaVersion?: string;
  available: boolean;
  pricePerHour?: number;
}

export interface SecretStatus {
  name: string;
  configured: boolean;
  maskedValue?: string;
  lastUpdated?: string;
}

export interface CredentialStatus {
  configured: boolean;
  secrets: SecretStatus[];
  message?: string;
}

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/providers')
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
    apiFetch(`/providers/${providerSlug}/gpu-options`)
      .then((res) => res.json())
      .then((data) => { if (data.success) setGpuOptions(data.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [providerSlug]);

  return { gpuOptions, loading };
}

export function useCredentialStatus(providerSlug: string | null) {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!providerSlug) { setStatus(null); return; }
    setLoading(true);
    try {
      const res = await apiFetch(`/credentials/${providerSlug}/credential-status`);
      const data = await res.json();
      if (data.success) setStatus(data.data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [providerSlug]);

  useEffect(() => { refresh(); }, [refresh]);

  return { credentialStatus: status, credentialLoading: loading, refreshCredentials: refresh };
}

export async function saveCredentials(
  providerSlug: string,
  secrets: Record<string, string>,
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await apiFetch(`/credentials/${providerSlug}/credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secrets }),
    });
    const data = await res.json();
    if (data.success) {
      return { success: true, message: data.data?.message || 'Credentials saved' };
    }
    const errorMsg = typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to save credentials';
    return { success: false, message: errorMsg };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export async function testProviderConnection(
  providerSlug: string,
): Promise<{ success: boolean; latencyMs?: number; error?: string; statusCode?: number }> {
  try {
    const res = await apiFetch(`/credentials/${providerSlug}/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (data.success) {
      return data.data;
    }
    return { success: false, error: data.error || 'Test failed' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

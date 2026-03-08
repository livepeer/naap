import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/apiFetch';

const IN_PROGRESS_STATES = ['PROVISIONING', 'DEPLOYING', 'VALIDATING', 'DESTROYING'];

export interface Deployment {
  id: string;
  name: string;
  providerSlug: string;
  providerMode: string;
  gpuModel: string;
  gpuVramGb: number;
  gpuCount: number;
  artifactType: string;
  artifactVersion: string;
  dockerImage: string;
  status: string;
  healthStatus: string;
  endpointUrl?: string;
  sshHost?: string;
  hasUpdate: boolean;
  latestAvailableVersion?: string;
  createdAt: string;
  updatedAt: string;
  lastHealthCheck?: string;
}

export function useDeployments() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/deployments');
      const data = await res.json();
      if (data.success) {
        setDeployments(data.data);
      } else {
        const err = data.error;
        setError(typeof err === 'string' ? err : err?.message || 'Request failed');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { deployments, loading, error, refresh };
}

export function useDeployment(id: string) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`/deployments/${id}`);
      const data = await res.json();
      if (data.success) setDeployment(data.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!deployment || !IN_PROGRESS_STATES.includes(deployment.status)) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    const poll = async () => {
      try {
        const syncRes = await apiFetch(`/deployments/${id}/sync-status`, { method: 'POST' });
        const syncData = await syncRes.json();
        if (syncData.success && syncData.data) {
          setDeployment(syncData.data);
          if (!IN_PROGRESS_STATES.includes(syncData.data.status)) {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      } catch {
        // ignore — will retry on next interval
      }
    };

    poll();
    timerRef.current = setInterval(poll, 5_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [deployment?.status, id]);

  return { deployment, loading, refresh };
}

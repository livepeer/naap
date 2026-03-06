import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api/v1/deployment-manager';

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
      const res = await fetch(`${API_BASE}/deployments`);
      const data = await res.json();
      if (data.success) {
        setDeployments(data.data);
      } else {
        setError(data.error);
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

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/deployments/${id}`);
      const data = await res.json();
      if (data.success) setDeployment(data.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  return { deployment, loading, refresh };
}

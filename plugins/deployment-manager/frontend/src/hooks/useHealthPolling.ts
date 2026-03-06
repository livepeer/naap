import { useState, useEffect, useRef } from 'react';

const API_BASE = '/api/v1/deployment-manager';

export function useHealthPolling(deploymentId: string | null, intervalMs = 30000) {
  const [healthStatus, setHealthStatus] = useState<string>('UNKNOWN');
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!deploymentId) return;

    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/health/${deploymentId}/check`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          setHealthStatus(data.data.status);
          setLastCheck(new Date().toISOString());
        }
      } catch {
        // ignore
      }
    };

    check();
    timerRef.current = setInterval(check, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [deploymentId, intervalMs]);

  return { healthStatus, lastCheck };
}

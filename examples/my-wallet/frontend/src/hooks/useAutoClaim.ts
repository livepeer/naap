/**
 * Auto-claim hook (S17)
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';

interface AutoClaimConfig {
  id: string;
  walletAddressId: string;
  enabled: boolean;
  minRewardLpt: string;
  lastClaimedAt: string | null;
}

export function useAutoClaim(walletAddressId?: string) {
  const [config, setConfig] = useState<AutoClaimConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    if (!walletAddressId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/auto-claim/${walletAddressId}`);
      if (res.ok) {
        const json = await res.json();
        setConfig(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch auto-claim config:', err);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddressId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const setAutoClaimConfig = useCallback(async (enabled: boolean, minRewardLpt: string) => {
    if (!walletAddressId) return;
    try {
      const res = await fetch(`${getApiUrl()}/auto-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddressId, enabled, minRewardLpt }),
      });
      if (res.ok) {
        const json = await res.json();
        setConfig(json.data);
      }
    } catch (err) {
      console.error('Failed to set auto-claim config:', err);
    }
  }, [walletAddressId]);

  return { config, isLoading, setAutoClaimConfig };
}

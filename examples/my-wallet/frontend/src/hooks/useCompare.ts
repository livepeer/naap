/**
 * useCompare - Hook for orchestrator comparison (up to 4)
 */

import { useState, useCallback } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';

interface OrchestratorData {
  address: string;
  name: string | null;
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  isActive: boolean;
  serviceUri: string | null;
}

export function useCompare() {
  const shell = useShell();
  const [orchestrators, setOrchestrators] = useState<OrchestratorData[]>([]);
  const [selectedAddresses, setSelectedAddresses] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchComparison = useCallback(async (addresses: string[]) => {
    if (addresses.length === 0) {
      setOrchestrators([]);
      return;
    }
    setIsLoading(true);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/orchestrators/compare?addresses=${addresses.join(',')}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      const data = json.data ?? json;
      setOrchestrators(data.orchestrators || []);
    } catch (err) {
      console.error('Failed to compare orchestrators:', err);
    } finally {
      setIsLoading(false);
    }
  }, [shell]);

  const addO = useCallback((address: string) => {
    if (selectedAddresses.length >= 4 || selectedAddresses.includes(address)) return;
    const next = [...selectedAddresses, address];
    setSelectedAddresses(next);
    fetchComparison(next);
  }, [selectedAddresses, fetchComparison]);

  const removeO = useCallback((address: string) => {
    const next = selectedAddresses.filter(a => a !== address);
    setSelectedAddresses(next);
    fetchComparison(next);
  }, [selectedAddresses, fetchComparison]);

  return { orchestrators, selectedAddresses, addO, removeO, isLoading };
}

/**
 * useWalletAddresses - Hook for multi-wallet address management
 */

import { useState, useEffect, useCallback } from 'react';
import { useShell, getPluginBackendUrl } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';

interface WalletAddress {
  id: string;
  userId: string;
  address: string;
  label: string | null;
  chainId: number;
  isPrimary: boolean;
  connectedAt: string;
  lastSyncedAt: string | null;
}

interface UseWalletAddressesReturn {
  addresses: WalletAddress[];
  isLoading: boolean;
  error: string | null;
  addAddress: (address: string, chainId: number, label?: string) => Promise<WalletAddress>;
  removeAddress: (id: string) => Promise<void>;
  setPrimary: (id: string) => Promise<void>;
  updateLabel: (id: string, label: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useWalletAddresses(): UseWalletAddressesReturn {
  const shell = useShell();
  const [addresses, setAddresses] = useState<WalletAddress[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = useCallback(async () => {
    const token = await shell.auth.getToken().catch(() => '');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [shell]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const apiUrl = getApiUrl();
      const headers = await getHeaders();
      const res = await fetch(`${apiUrl}/addresses`, { headers });
      const json = await res.json();
      const data = json.data ?? json;
      setAddresses(data.addresses || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch addresses');
    } finally {
      setIsLoading(false);
    }
  }, [getHeaders]);

  const addAddress = useCallback(async (address: string, chainId: number, label?: string) => {
    const apiUrl = getApiUrl();
    const headers = await getHeaders();
    const res = await fetch(`${apiUrl}/addresses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ address, chainId, label }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Failed to add address');
    const data = json.data ?? json;
    await refresh();
    return data.address;
  }, [getHeaders, refresh]);

  const removeAddress = useCallback(async (id: string) => {
    const apiUrl = getApiUrl();
    const headers = await getHeaders();
    const res = await fetch(`${apiUrl}/addresses/${id}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.message || 'Failed to remove address');
    }
    await refresh();
  }, [getHeaders, refresh]);

  const setPrimary = useCallback(async (id: string) => {
    const apiUrl = getApiUrl();
    const headers = await getHeaders();
    const res = await fetch(`${apiUrl}/addresses/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isPrimary: true }),
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.message || 'Failed to set primary');
    }
    await refresh();
  }, [getHeaders, refresh]);

  const updateLabel = useCallback(async (id: string, label: string) => {
    const apiUrl = getApiUrl();
    const headers = await getHeaders();
    const res = await fetch(`${apiUrl}/addresses/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.message || 'Failed to update label');
    }
    await refresh();
  }, [getHeaders, refresh]);

  useEffect(() => {
    const user = shell.auth.getUser();
    if (user) refresh();
  }, [shell, refresh]);

  return { addresses, isLoading, error, addAddress, removeAddress, setPrimary, updateLabel, refresh };
}

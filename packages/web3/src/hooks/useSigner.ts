/**
 * useSigner Hook
 *
 * Gets the current signer from the connected wallet provider.
 */

import { useState, useEffect } from 'react';
import type { BrowserProvider, JsonRpcSigner } from 'ethers';

/**
 * Hook to get the current ethers Signer from a BrowserProvider.
 */
export function useSigner(provider: BrowserProvider | null): {
  signer: JsonRpcSigner | null;
  loading: boolean;
  error: Error | null;
} {
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!provider) {
      setSigner(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    provider.getSigner()
      .then((s) => {
        if (!cancelled) {
          setSigner(s);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Failed to get signer'));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [provider]);

  return { signer, loading, error };
}

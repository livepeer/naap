/**
 * useSIWE Hook
 * React hook for Sign-In With Ethereum authentication flow
 */

'use client';

import { useState, useCallback } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';
import { SiweMessage } from 'siwe';
import {
  getSIWENonce,
  loginWithSIWE,
  storeRemoteSignerToken,
  clearRemoteSignerToken,
  type RemoteSignerToken,
} from '../lib/api/siwe';
import { useAuth } from '../contexts/auth-context';

export interface UseSIWEOptions {
  onSuccess?: (token: RemoteSignerToken) => void;
  onError?: (error: Error) => void;
}

export function useSIWE(options: UseSIWEOptions = {}) {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { loginWithWallet } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Execute the full SIWE authentication flow:
   * 1. Get nonce from jwt-issuer
   * 2. Create SIWE message
   * 3. Sign message with wallet
   * 4. Verify signature and get JWT from jwt-issuer
   * 5. Login to naap with wallet address
   * 6. Store JWT for remote signer use
   */
  const signIn = useCallback(async () => {
    if (!address) {
      const err = new Error('No wallet connected');
      setError(err);
      options.onError?.(err);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Get nonce from jwt-issuer
      const nonceResponse = await getSIWENonce();

      // Step 2: Create SIWE message
      const message = new SiweMessage({
        domain: nonceResponse.domain,
        address,
        statement: 'Sign in to NaaP Platform with Ethereum',
        uri: window.location.origin,
        version: '1',
        chainId: chainId || 1,
        nonce: nonceResponse.nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageString = message.prepareMessage();

      // Step 3: Sign message with wallet
      const signature = await signMessageAsync({
        message: messageString,
      });

      // Step 4: Verify signature and get JWT from jwt-issuer
      const loginResponse = await loginWithSIWE(messageString, signature);

      // Store remote signer token for later use
      const remoteSignerToken: RemoteSignerToken = {
        jwt: loginResponse.token,
        expiresAt: loginResponse.expires_at,
        address: loginResponse.address,
      };
      storeRemoteSignerToken(remoteSignerToken);

      // Step 5: Login to naap with wallet address and JWT
      // The backend will verify the JWT and create/link a naap account
      await loginWithWallet(address, signature, loginResponse.token as string);

      options.onSuccess?.(remoteSignerToken);

      return remoteSignerToken;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('SIWE authentication failed');
      setError(error);
      options.onError?.(error);

      // Clear any partial state
      clearRemoteSignerToken();
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [address, chainId, signMessageAsync, loginWithWallet, options]);

  /**
   * Sign out and disconnect wallet
   */
  const signOut = useCallback(() => {
    clearRemoteSignerToken();
    disconnect();
  }, [disconnect]);

  return {
    signIn,
    signOut,
    isLoading,
    error,
    address,
    isConnected: !!address,
  };
}

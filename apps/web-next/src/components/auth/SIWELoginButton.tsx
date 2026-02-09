/**
 * SIWE (Sign In With Ethereum) Login Button
 * Handles wallet connection and SIWE authentication flow
 */

'use client';

import { useState, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useSIWE } from '../../hooks/useSIWE';

// Make component compatible with the wallet connectors API
type WagmiConnector = any;

export function SIWELoginButton() {
  const { isConnected, address, connector } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signIn, isLoading: isSigningIn, error } = useSIWE();

  // Prevent hydration mismatch by only rendering connectors on client
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const [step, setStep] = useState<'connect' | 'sign'>('connect');

  const handleConnect = async (connectorInstance: WagmiConnector) => {
    try {
      connect({ connector: connectorInstance });
      setStep('sign');
    } catch (err) {
      console.error('Failed to connect wallet:', err);
    }
  };

  const handleSignIn = async () => {
    try {
      await signIn();
      // Redirect happens automatically via auth context
    } catch (err) {
      console.error('SIWE authentication failed:', err);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setStep('connect');
  };

  // Show loading state during SSR and initial client render
  if (!mounted) {
    return (
      <div className="space-y-3">
        <div className="text-center text-sm text-gray-600 dark:text-gray-400 mb-4">
          Loading wallet connectors...
        </div>
        <div className="w-full flex items-center justify-center py-8">
          <Spinner />
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="space-y-3">
        <div className="text-center text-sm text-gray-600 dark:text-gray-400 mb-4">
          Sign in with your Ethereum wallet
        </div>
        {connectors.map((connectorInstance) => (
          <button
            key={connectorInstance.uid}
            onClick={() => handleConnect(connectorInstance)}
            disabled={isConnecting}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <WalletIcon />
            <span className="font-medium">
              {isConnecting ? 'Connecting...' : `Connect ${connectorInstance.name}`}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Connected Wallet</div>
          <div className="font-mono text-sm font-medium mt-1">
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            via {connector?.name}
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          className="text-sm text-red-600 dark:text-red-400 hover:underline"
        >
          Disconnect
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="text-sm text-red-800 dark:text-red-200">
            {error.message}
          </div>
        </div>
      )}

      <button
        onClick={handleSignIn}
        disabled={isSigningIn}
        className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSigningIn ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner />
            Signing message...
          </span>
        ) : (
          'Sign In With Ethereum'
        )}
      </button>

      <div className="text-xs text-center text-gray-500 dark:text-gray-400">
        By signing in, you agree to authenticate using your Ethereum wallet.
        <br />
        You will be prompted to sign a message in your wallet.
      </div>
    </div>
  );
}

function WalletIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

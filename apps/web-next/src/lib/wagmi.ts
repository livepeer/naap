/**
 * Wagmi configuration for Web3 wallet connections
 * Supports multiple chains and wallet connectors
 */

import { http, createConfig } from 'wagmi';
import { mainnet, arbitrum, base, sepolia, arbitrumSepolia, baseSepolia } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

// Get WalletConnect Project ID from environment
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// Configure supported chains based on environment
const isProduction = process.env.NODE_ENV === 'production';

export const supportedChains = isProduction
  ? [mainnet, arbitrum, base]
  : [mainnet, arbitrum, base, sepolia, arbitrumSepolia, baseSepolia];

// Create wagmi config
export const wagmiConfig = createConfig({
  chains: supportedChains as any,
  connectors: [
    injected({
      shimDisconnect: true,
    }),
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            metadata: {
              name: 'NaaP Platform',
              description: 'Node as a Platform - Livepeer AI Compute Network',
              url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
              icons: ['https://livepeer.org/favicon.ico'],
            },
          }),
        ]
      : []),
  ],
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    [sepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
    [baseSepolia.id]: http(),
  },
});

export type WagmiConfig = typeof wagmiConfig;

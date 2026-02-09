/**
 * Web3 Provider Management
 *
 * Creates ethers.js providers for supported chains.
 */

import { BrowserProvider, JsonRpcProvider, type Eip1193Provider } from 'ethers';

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  1: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://eth.llamarpc.com',
    blockExplorer: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    blockExplorer: 'https://arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  421614: {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    blockExplorer: 'https://sepolia.arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  11155111: {
    chainId: 11155111,
    name: 'Sepolia Testnet',
    rpcUrl: 'https://rpc.sepolia.org',
    blockExplorer: 'https://sepolia.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
};

/**
 * Get chain configuration by chain ID.
 */
export function getChainConfig(chainId: number): ChainConfig | undefined {
  return SUPPORTED_CHAINS[chainId];
}

/**
 * Create a provider for a specific chain.
 * If window.ethereum is available and on the correct chain, uses BrowserProvider.
 * Otherwise falls back to a JsonRpcProvider.
 */
export function createProvider(chainId: number): JsonRpcProvider | BrowserProvider {
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  // Try browser wallet first
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ethereum = (window as any).ethereum as Eip1193Provider | undefined;
    if (ethereum) {
      return new BrowserProvider(ethereum);
    }
  }

  // Fallback to RPC
  return new JsonRpcProvider(chain.rpcUrl, chainId);
}

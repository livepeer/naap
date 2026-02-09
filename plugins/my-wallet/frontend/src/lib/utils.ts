/**
 * Wallet utility functions
 */

import { formatUnits, parseUnits } from 'ethers';

/**
 * Format a wallet address for display (0x1234...5678)
 */
export function formatAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format a balance from wei to human-readable
 */
export function formatBalance(wei: bigint | string, decimals = 18, displayDecimals = 4): string {
  const value = typeof wei === 'string' ? BigInt(wei) : wei;
  const formatted = formatUnits(value, decimals);
  const num = parseFloat(formatted);
  
  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals,
  });
}

/**
 * Parse a human-readable amount to wei
 */
export function parseAmount(amount: string, decimals = 18): bigint {
  return parseUnits(amount, decimals);
}

/**
 * Format a transaction hash for display
 */
export function formatTxHash(hash: string, chars = 8): string {
  if (!hash) return '';
  return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`;
}

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerTxUrl(chainId: number, txHash: string): string {
  const explorers: Record<number, string> = {
    1: 'https://etherscan.io',
    42161: 'https://arbiscan.io',
    5: 'https://goerli.etherscan.io',
    421613: 'https://goerli.arbiscan.io',
  };
  
  const base = explorers[chainId] || 'https://etherscan.io';
  return `${base}/tx/${txHash}`;
}

/**
 * Get block explorer URL for an address
 */
export function getExplorerAddressUrl(chainId: number, address: string): string {
  const explorers: Record<number, string> = {
    1: 'https://etherscan.io',
    42161: 'https://arbiscan.io',
    5: 'https://goerli.etherscan.io',
    421613: 'https://goerli.arbiscan.io',
  };
  
  const base = explorers[chainId] || 'https://etherscan.io';
  return `${base}/address/${address}`;
}

/**
 * Check if MetaMask is installed
 */
export function isMetaMaskInstalled(): boolean {
  return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
}

/**
 * Delay utility
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

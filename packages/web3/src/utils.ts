/**
 * Web3 Utility Functions
 */

import { ethers } from 'ethers';

/**
 * Validate an Ethereum address.
 */
export function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * Shorten an address for display (e.g., 0x1234...5678).
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!isValidAddress(address)) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format wei value to ether string.
 */
export function formatEther(wei: bigint | string): string {
  return ethers.formatEther(wei);
}

/**
 * Parse ether string to wei value.
 */
export function parseEther(ether: string): bigint {
  return ethers.parseEther(ether);
}

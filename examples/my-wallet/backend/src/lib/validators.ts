/**
 * Shared validation helpers for wallet operations
 */

export const isValidAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

export const isValidChainId = (chainId: number): boolean => {
  return [1, 5, 42161, 421613].includes(chainId);
};

export const isValidTxHash = (hash: string): boolean => {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
};

export const isValidLabel = (label: string): boolean => {
  return label.length > 0 && label.length <= 50;
};

export interface AddressInput {
  address: string;
  chainId: number;
  label?: string;
}

export function validateAddressInput(input: AddressInput): string | null {
  if (!input.address) return 'address is required';
  if (!isValidAddress(input.address)) return 'Invalid Ethereum address format';
  if (input.chainId === undefined || input.chainId === null) return 'chainId is required';
  if (!isValidChainId(input.chainId)) return 'Unsupported chain ID';
  if (input.label !== undefined && input.label !== null && !isValidLabel(input.label)) {
    return 'Label must be between 1 and 50 characters';
  }
  return null;
}

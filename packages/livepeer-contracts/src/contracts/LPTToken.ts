/**
 * LPT Token Contract Wrapper
 *
 * ERC-20 Livepeer Token operations.
 */

import { Contract, type Signer, type ContractRunner, type TransactionResponse } from 'ethers';
import { getContractAddresses } from '../addresses.js';

const LPT_TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
];

export interface LPTTokenContract {
  name: () => Promise<string>;
  symbol: () => Promise<string>;
  decimals: () => Promise<number>;
  totalSupply: () => Promise<bigint>;
  balanceOf: (account: string) => Promise<bigint>;
  allowance: (owner: string, spender: string) => Promise<bigint>;
  approve: (spender: string, amount: bigint) => Promise<TransactionResponse>;
  transfer: (to: string, amount: bigint) => Promise<TransactionResponse>;
}

/**
 * Create a typed LPT Token contract instance.
 */
export function createLPTToken(
  chainId: number,
  signerOrProvider: Signer | ContractRunner
): LPTTokenContract {
  const addresses = getContractAddresses(chainId);
  if (!addresses) {
    throw new Error(`No Livepeer contracts found for chain ${chainId}`);
  }

  const contract = new Contract(addresses.lptToken, LPT_TOKEN_ABI, signerOrProvider);

  return {
    name: () => contract.name() as Promise<string>,
    symbol: () => contract.symbol() as Promise<string>,
    decimals: () => contract.decimals().then(Number) as Promise<number>,
    totalSupply: () => contract.totalSupply() as Promise<bigint>,
    balanceOf: (account) => contract.balanceOf(account) as Promise<bigint>,
    allowance: (owner, spender) => contract.allowance(owner, spender) as Promise<bigint>,
    approve: (spender, amount) => contract.approve(spender, amount) as Promise<TransactionResponse>,
    transfer: (to, amount) => contract.transfer(to, amount) as Promise<TransactionResponse>,
  };
}

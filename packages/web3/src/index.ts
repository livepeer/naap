/**
 * @naap/web3
 *
 * Shared Web3 utilities for NaaP plugins.
 * Provides wallet connection, signer management, network switching,
 * and transaction monitoring.
 */

export { useWalletConnect, type WalletState } from './hooks/useWalletConnect.js';
export { useSigner } from './hooks/useSigner.js';
export { useSwitchNetwork } from './hooks/useSwitchNetwork.js';
export { useTransactionMonitor, type TransactionState } from './hooks/useTransactionMonitor.js';
export { useBalance } from './hooks/useBalance.js';
export {
  createProvider,
  getChainConfig,
  SUPPORTED_CHAINS,
  type ChainConfig,
} from './provider.js';
export {
  isValidAddress,
  shortenAddress,
  formatEther,
  parseEther,
} from './utils.js';

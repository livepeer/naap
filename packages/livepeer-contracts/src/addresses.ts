/**
 * Livepeer Contract Addresses
 *
 * Addresses for all chains where Livepeer is deployed.
 * Source: https://docs.livepeer.org/reference/deployed-contract-addresses
 */

export interface LivepeerAddresses {
  controller: string;
  bondingManager: string;
  roundsManager: string;
  lptToken: string;
  minter: string;
  ticketBroker: string;
  serviceRegistry: string;
}

/** Livepeer contract addresses per chain ID */
export const LIVEPEER_ADDRESSES: Record<number, LivepeerAddresses> = {
  // Ethereum Mainnet (L1 -- legacy, most stake migrated to Arbitrum)
  1: {
    controller: '0xf96d54e490317c557a967abb1bd11be54fc2e99a',
    bondingManager: '0x511bc4556d823ae99630ae8de28b9b80df90ea2e',
    roundsManager: '0x3984fc4ceeef1739135476f625d36d6c35c40dc3',
    lptToken: '0x58b6A8A3302369DAEc383334672404Ee733aB239',
    minter: '0xc20DE37170B45774e6CD3d2304017fc962ffe7e0',
    ticketBroker: '0xa8bb618b1520e284d30b4189C1f5e9B4e5Cc2a1C',
    serviceRegistry: '0x406a112f3218b988c66778fd72fc8467f2601366',
  },

  // Arbitrum One (primary network for Livepeer)
  42161: {
    controller: '0xD8E8328501E9645d16Cf49539efC04f734606ee4',
    bondingManager: '0x35Bcf3c30594191d53231E4FF333E8A770453e40',
    roundsManager: '0xdd6f56DcC28D3F5f27084571846AF3B5E776EEb1',
    lptToken: '0x289ba1701C2F088cf0faf8B3705246331cB8A839',
    minter: '0xc20DE37170B45774e6CD3d2304017fc962ffe7e0',
    ticketBroker: '0xa8bb618b1520E284d30B4189c1F5e9b4e5cc2a1c',
    serviceRegistry: '0x406a112f3218b988c66778fd72fc8467f2601366',
  },

  // Arbitrum Sepolia (testnet)
  421614: {
    controller: '0x0000000000000000000000000000000000000000',
    bondingManager: '0x0000000000000000000000000000000000000000',
    roundsManager: '0x0000000000000000000000000000000000000000',
    lptToken: '0x0000000000000000000000000000000000000000',
    minter: '0x0000000000000000000000000000000000000000',
    ticketBroker: '0x0000000000000000000000000000000000000000',
    serviceRegistry: '0x0000000000000000000000000000000000000000',
  },
};

/**
 * Get contract addresses for a specific chain.
 */
export function getContractAddresses(chainId: number): LivepeerAddresses | undefined {
  return LIVEPEER_ADDRESSES[chainId];
}

/**
 * Livepeer Contract Addresses and ABIs
 */

export const NETWORKS = {
  mainnet: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://mainnet.infura.io/v3/',
    blockExplorer: 'https://etherscan.io',
    contracts: {
      bondingManager: '0x511Bc4556D823Ae99630aE8deF7D1d6b4b60F6C2',
      livepeerToken: '0x58b6A8A3302369DAEc383334672404Ee733aB239',
      roundsManager: '0x3984fc4ceFaFc614C0C0C8A7E8aF87e9b6a9c1F0',
    },
  },
  'arbitrum-one': {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    blockExplorer: 'https://arbiscan.io',
    contracts: {
      bondingManager: '0x35Bcf3c30594191d53231E4FF333E8A770453e40',
      livepeerToken: '0x289ba1701C2F088cf0faf8B3705246331cB8A839',
      roundsManager: '0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f',
    },
  },
  goerli: {
    chainId: 5,
    name: 'Goerli Testnet',
    rpcUrl: 'https://goerli.infura.io/v3/',
    blockExplorer: 'https://goerli.etherscan.io',
    contracts: {
      bondingManager: '0x0000000000000000000000000000000000000000',
      livepeerToken: '0x0000000000000000000000000000000000000000',
      roundsManager: '0x0000000000000000000000000000000000000000',
    },
  },
  'arbitrum-goerli': {
    chainId: 421613,
    name: 'Arbitrum Goerli',
    rpcUrl: 'https://goerli-rollup.arbitrum.io/rpc',
    blockExplorer: 'https://goerli.arbiscan.io',
    contracts: {
      bondingManager: '0x0000000000000000000000000000000000000000',
      livepeerToken: '0x0000000000000000000000000000000000000000',
      roundsManager: '0x0000000000000000000000000000000000000000',
    },
  },
} as const;

export type NetworkId = keyof typeof NETWORKS;

export const SUPPORTED_CHAIN_IDS: number[] = Object.values(NETWORKS).map(n => n.chainId);

export function getNetworkByChainId(chainId: number) {
  return Object.values(NETWORKS).find(n => n.chainId === chainId);
}

export function getNetworkById(id: NetworkId) {
  return NETWORKS[id];
}

// ERC-20 ABI (minimal for LPT operations)
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// Bonding Manager ABI (minimal for staking operations)
export const BONDING_MANAGER_ABI = [
  'function bond(uint256 _amount, address _to) external',
  'function unbond(uint256 _amount) external',
  'function rebond(uint256 _unbondingLockId) external',
  'function withdrawStake(uint256 _unbondingLockId) external',
  'function withdrawFees(address payable _recipient, uint256 _amount) external',
  'function claimEarnings(uint256 _endRound) external',
  'function getDelegator(address _delegator) view returns (uint256 bondedAmount, uint256 fees, address delegateAddress, uint256 delegatedAmount, uint256 startRound, uint256 lastClaimRound, uint256 nextUnbondingLockId)',
  'function pendingStake(address _delegator, uint256 _endRound) view returns (uint256)',
  'function pendingFees(address _delegator, uint256 _endRound) view returns (uint256)',
  'function isRegisteredTranscoder(address _transcoder) view returns (bool)',
  'function transcoderTotalStake(address _transcoder) view returns (uint256)',
  'function getTranscoder(address _transcoder) view returns (uint256 lastRewardRound, uint256 rewardCut, uint256 feeShare, uint256 lastActiveStakeUpdateRound, uint256 activationRound, uint256 deactivationRound, uint256 activeCumulativeRewards, uint256 cumulativeRewards, uint256 cumulativeFees, uint256 lastFeeRound)',
];

// Rounds Manager ABI (minimal)
export const ROUNDS_MANAGER_ABI = [
  'function currentRound() view returns (uint256)',
  'function currentRoundStartBlock() view returns (uint256)',
  'function lastRoundLengthUpdateRound() view returns (uint256)',
  'function lastRoundLengthUpdateStartBlock() view returns (uint256)',
  'function roundLength() view returns (uint256)',
  'function roundLockAmount() view returns (uint256)',
  'function currentRoundLocked() view returns (bool)',
];

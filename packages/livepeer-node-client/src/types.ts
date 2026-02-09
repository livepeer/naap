/**
 * Types mirroring go-livepeer's actual data structures.
 */

export interface NodeStatus {
  address: string;
  serviceURI: string;
  lastRewardRound: number;
  rewardCut: number;
  feeShare: number;
  delegatedStake: string;
  active: boolean;
  version: string;
}

export interface OrchestratorInfo {
  address: string;
  serviceURI: string;
  rewardCut: string;
  feeShare: string;
  delegatedStake: string;
  activationRound: string;
  deactivationRound: string;
  active: boolean;
  status: 'Registered' | 'Not Registered';
}

export interface Transcoder {
  address: string;
  serviceURI: string;
  active: boolean;
  delegatedStake: string;
  rewardCut: string;
  feeShare: string;
  lastRewardRound: string;
  activationRound: string;
  deactivationRound: string;
  pricePerPixel: string;
  status: 'Registered' | 'Not Registered';
}

export interface Delegator {
  address: string;
  bondedAmount: string;
  fees: string;
  delegateAddress: string;
  delegatedAmount: string;
  startRound: string;
  lastClaimRound: string;
  pendingStake: string;
  pendingFees: string;
  status: 'Pending' | 'Bonded' | 'Unbonded';
}

export interface UnbondingLock {
  id: number;
  delegator: string;
  amount: string;
  withdrawRound: string;
}

export interface SenderInfo {
  deposit: string;
  withdrawRound: string;
  reserve: {
    fundsRemaining: string;
    claimedInCurrentRound: string;
  };
}

export interface ProtocolParameters {
  roundLength: number;
  currentRound: number;
  lastInitializedRound: number;
  totalBonded: string;
  totalSupply: string;
  inflation: string;
  inflationChange: string;
  targetBondingRate: string;
  paused: boolean;
}

export interface RoundInfo {
  number: number;
  initialized: boolean;
  startBlock: number;
  length: number;
}

export interface TxResult {
  hash: string;
  status: 'success' | 'pending' | 'error';
  message?: string;
}

export interface ContractAddresses {
  controller: string;
  bondingManager: string;
  roundsManager: string;
  token: string;
  minter: string;
  ticketBroker: string;
  serviceRegistry: string;
}

export interface Capability {
  id: number;
  name: string;
  description?: string;
  mandatory: boolean;
}

export interface NetworkCapabilities {
  capabilities: Capability[];
  orchestrators: {
    address: string;
    capabilities: number[];
  }[];
}

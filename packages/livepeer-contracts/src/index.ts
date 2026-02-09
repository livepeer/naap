/**
 * @naap/livepeer-contracts
 *
 * Typed Livepeer smart contract wrappers.
 * Provides typed access to BondingManager, LPT Token, RoundsManager, and more.
 */

export { LIVEPEER_ADDRESSES, getContractAddresses, type LivepeerAddresses } from './addresses.js';
export {
  createBondingManager,
  type BondingManagerContract,
} from './contracts/BondingManager.js';
export {
  createLPTToken,
  type LPTTokenContract,
} from './contracts/LPTToken.js';
export {
  createRoundsManager,
  type RoundsManagerContract,
} from './contracts/RoundsManager.js';
export {
  useStaking,
  type StakingActions,
  type DelegatorState,
} from './hooks/useStaking.js';
export {
  useLPTBalance,
} from './hooks/useLPTBalance.js';
export {
  useCurrentRound,
  type RoundInfo,
} from './hooks/useCurrentRound.js';

/**
 * Mark unbonding locks as "withdrawable" when withdrawRound <= currentRound
 */

import { markWithdrawableLocks } from '../lib/unbondingService.js';
import { getProtocolParams } from '../lib/protocolService.js';

export async function updateUnbonding(): Promise<number> {
  const params = await getProtocolParams();
  const result = await markWithdrawableLocks(params.currentRound);
  console.log(`[unbonding] Marked ${result.count} locks as withdrawable (round ${params.currentRound})`);
  return result.count;
}

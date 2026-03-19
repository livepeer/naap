/**
 * Monthly snapshot job — runs daily, captures delegator balances on month's last day.
 * Records LPT rewards accrued and ETH fees for performance tracking.
 */

import { prisma } from '../db/client.js';
import { getDelegator, getProtocol, getPrices, toWei } from '../lib/livepeer.js';

function isLastDayOfMonth(date: Date): boolean {
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getMonth() !== date.getMonth();
}

function formatMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export async function monthlySnapshot(force = false): Promise<number> {
  const now = new Date();

  if (!force && !isLastDayOfMonth(now)) {
    return 0;
  }

  const month = formatMonth(now);
  console.log(`[monthlySnapshot] Capturing snapshot for ${month}...`);

  const [protocol, prices] = await Promise.all([getProtocol(), getPrices()]);
  const currentRound = protocol.currentRound;

  const states = await prisma.walletStakingState.findMany({
    where: { stakedAmount: { not: '0' } },
  });

  let count = 0;

  for (const state of states) {
    try {
      const delegator = await getDelegator(state.address);
      if (!delegator || !delegator.delegateAddress) continue;

      // Look up previous month's snapshot to compute deltas
      const prevMonth = previousMonth(month);
      const prevSnap = await prisma.walletMonthlySnapshot.findUnique({
        where: {
          month_walletAddress_orchestratorAddr: {
            month: prevMonth,
            walletAddress: state.address.toLowerCase(),
            orchestratorAddr: delegator.delegateAddress.toLowerCase(),
          },
        },
      });

      const currentPendingStake = BigInt(toWei(delegator.bondedAmount));
      const currentPrincipal = BigInt(toWei(delegator.principal));

      let lptRewardsAccrued = '0';
      if (prevSnap) {
        const prevPendingStake = BigInt(prevSnap.pendingStake);
        const prevPrincipal = BigInt(prevSnap.principal);
        const principalDelta = currentPrincipal - prevPrincipal;
        const stakeGrowth = currentPendingStake - prevPendingStake;
        const rewards = stakeGrowth - (principalDelta > 0n ? principalDelta : 0n);
        lptRewardsAccrued = (rewards > 0n ? rewards : 0n).toString();
      } else {
        const rewards = currentPendingStake - currentPrincipal;
        lptRewardsAccrued = (rewards > 0n ? rewards : 0n).toString();
      }

      const ethFeesAccrued = toWei(delegator.fees);

      await prisma.walletMonthlySnapshot.upsert({
        where: {
          month_walletAddress_orchestratorAddr: {
            month,
            walletAddress: state.address.toLowerCase(),
            orchestratorAddr: delegator.delegateAddress.toLowerCase(),
          },
        },
        update: {
          bondedAmount: toWei(delegator.principal),
          pendingStake: toWei(delegator.bondedAmount),
          principal: toWei(delegator.principal),
          lptRewardsAccrued,
          ethFeesAccrued,
          lptPriceUsd: prices.lptUsd,
          ethPriceUsd: prices.ethUsd,
          round: currentRound,
          snapshotAt: new Date(),
        },
        create: {
          month,
          walletAddress: state.address.toLowerCase(),
          orchestratorAddr: delegator.delegateAddress.toLowerCase(),
          bondedAmount: toWei(delegator.principal),
          pendingStake: toWei(delegator.bondedAmount),
          principal: toWei(delegator.principal),
          lptRewardsAccrued,
          ethFeesAccrued,
          lptPriceUsd: prices.lptUsd,
          ethPriceUsd: prices.ethUsd,
          round: currentRound,
        },
      });
      count++;
    } catch (err: any) {
      console.warn(`[monthlySnapshot] Failed for ${state.address}:`, err.message);
    }
  }

  console.log(`[monthlySnapshot] Captured ${count} snapshots for ${month}`);
  return count;
}

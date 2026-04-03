/**
 * Seed script for my-wallet plugin
 * Creates sample orchestrators, wallet data, transactions, governance, network history etc.
 *
 * Usage: source .env.local && npx tsx examples/my-wallet/backend/seed.ts
 */

import { PrismaClient } from '../../../packages/database/src/generated/client/index.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding my-wallet plugin data...');

  // 1. Find or create a user
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: 'seed-user-001',
        email: 'test@naap.io',
        name: 'Test Wallet User',
      },
    });
    console.log('  Created user:', user.id);
  } else {
    console.log('  Using existing user:', user.id);
  }

  // 2. Create wallet connection
  await prisma.walletConnection.upsert({
    where: { userId: user.id },
    update: { address: '0xDEAD000000000000000000000000000000000001', chainId: 42161 },
    create: {
      userId: user.id,
      address: '0xDEAD000000000000000000000000000000000001',
      chainId: 42161,
    },
  });
  console.log('  Wallet connection upserted');

  // 3. Create wallet addresses (multi-address portfolio)
  const addr1 = await prisma.walletAddress.upsert({
    where: { userId_address_chainId: { userId: user.id, address: '0xDEAD000000000000000000000000000000000001', chainId: 42161 } },
    update: {},
    create: {
      userId: user.id,
      address: '0xDEAD000000000000000000000000000000000001',
      label: 'Main Wallet',
      chainId: 42161,
      isPrimary: true,
    },
  });

  const addr2 = await prisma.walletAddress.upsert({
    where: { userId_address_chainId: { userId: user.id, address: '0xDEAD000000000000000000000000000000000002', chainId: 42161 } },
    update: {},
    create: {
      userId: user.id,
      address: '0xDEAD000000000000000000000000000000000002',
      label: 'Cold Storage',
      chainId: 42161,
      isPrimary: false,
    },
  });
  console.log('  Wallet addresses upserted:', addr1.id, addr2.id);

  // 4. Create orchestrators
  const orchestrators = [
    { address: '0xAAAA000000000000000000000000000000000001', name: 'Livepeer Alpha Node', totalStake: '150000000000000000000000', rewardCut: 10, feeShare: 50, isActive: true },
    { address: '0xAAAA000000000000000000000000000000000002', name: 'StakeDAO Orchestrator', totalStake: '80000000000000000000000', rewardCut: 15, feeShare: 40, isActive: true },
    { address: '0xAAAA000000000000000000000000000000000003', name: 'Titan Video', totalStake: '200000000000000000000000', rewardCut: 5, feeShare: 60, isActive: true },
    { address: '0xAAAA000000000000000000000000000000000004', name: 'NodeMax', totalStake: '45000000000000000000000', rewardCut: 20, feeShare: 35, isActive: true },
    { address: '0xAAAA000000000000000000000000000000000005', name: 'Inactive Node', totalStake: '5000000000000000000000', rewardCut: 30, feeShare: 20, isActive: false },
    { address: '0xAAAA000000000000000000000000000000000006', name: 'Genesis Validator', totalStake: '300000000000000000000000', rewardCut: 8, feeShare: 55, isActive: true },
    { address: '0xAAAA000000000000000000000000000000000007', name: 'StreamPro', totalStake: '60000000000000000000000', rewardCut: 12, feeShare: 45, isActive: true },
    { address: '0xAAAA000000000000000000000000000000000008', name: 'MediaChain', totalStake: '25000000000000000000000', rewardCut: 18, feeShare: 30, isActive: true },
  ];

  for (const o of orchestrators) {
    await prisma.walletOrchestrator.upsert({
      where: { address: o.address },
      update: { name: o.name, totalStake: o.totalStake, rewardCut: o.rewardCut, feeShare: o.feeShare, isActive: o.isActive },
      create: { ...o, chainId: 42161 },
    });
  }
  console.log(`  ${orchestrators.length} orchestrators upserted`);

  // 5. Create staking states (delegated positions)
  await prisma.walletStakingState.upsert({
    where: { address: addr1.address },
    update: {},
    create: {
      address: addr1.address,
      walletAddressId: addr1.id,
      chainId: 42161,
      stakedAmount: '5000000000000000000000',  // 5000 LPT
      delegatedTo: orchestrators[0].address,
      pendingRewards: '120000000000000000000',  // 120 LPT
      pendingFees: '5000000000000000',          // 0.005 ETH
      startRound: '3200',
      lastClaimRound: '3280',
    },
  });
  await prisma.walletStakingState.upsert({
    where: { address: addr2.address },
    update: {},
    create: {
      address: addr2.address,
      walletAddressId: addr2.id,
      chainId: 42161,
      stakedAmount: '2000000000000000000000',  // 2000 LPT
      delegatedTo: orchestrators[2].address,
      pendingRewards: '45000000000000000000',   // 45 LPT
      pendingFees: '2000000000000000',          // 0.002 ETH
      startRound: '3100',
      lastClaimRound: '3270',
    },
  });
  console.log('  Staking states upserted');

  // 6. Create transaction log (for gas accounting, P&L)
  const txTypes = ['stake', 'unstake', 'claim', 'transfer'];
  const txStatuses = ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'pending', 'failed'];
  const now = Date.now();

  for (let i = 0; i < 25; i++) {
    const type = txTypes[i % txTypes.length];
    const status = txStatuses[i % txStatuses.length];
    const hash = `0x${(1000 + i).toString(16).padStart(64, '0')}`;
    const timestamp = new Date(now - i * 86400000); // 1 day apart

    await prisma.walletTransactionLog.upsert({
      where: { txHash: hash },
      update: {},
      create: {
        userId: user.id,
        address: i % 2 === 0 ? addr1.address : addr2.address,
        walletAddressId: i % 2 === 0 ? addr1.id : addr2.id,
        txHash: hash,
        type,
        status,
        chainId: 42161,
        value: `${(100 + i * 10)}000000000000000000`,
        gasUsed: `${21000 + i * 1000}`,
        gasPrice: `${20000000000 + i * 1000000000}`,
        blockNumber: 200000 + i,
        timestamp,
      },
    });
  }
  console.log('  25 transactions seeded');

  // 7. Orchestrator round history (for reward consistency / S9)
  const baseRound = 3200;
  for (const o of orchestrators.slice(0, 4)) {
    for (let r = 0; r < 100; r++) {
      const round = baseRound + r;
      // Alpha Node: 95% call rate, StakeDAO: 80%, Titan: 99%, NodeMax: 60%
      let calledReward = true;
      if (o.name === 'StakeDAO Orchestrator' && r % 5 === 0) calledReward = false;
      if (o.name === 'NodeMax' && r % 3 === 0) calledReward = false;
      if (o.name === 'Livepeer Alpha Node' && r % 20 === 0) calledReward = false;

      await prisma.walletOrchestratorRoundHistory.upsert({
        where: { orchestratorAddr_round: { orchestratorAddr: o.address, round } },
        update: {},
        create: {
          orchestratorAddr: o.address,
          round,
          calledReward,
          rewardCut: o.rewardCut,
          feeShare: o.feeShare,
          totalStake: o.totalStake,
        },
      });
    }
  }
  console.log('  400 round history records seeded (4 orchestrators × 100 rounds)');

  // 8. Network snapshots (S21)
  for (let i = 0; i < 30; i++) {
    const round = baseRound + i * 3;
    const snapshotAt = new Date(now - i * 6 * 3600000); // 6 hours apart
    await prisma.walletNetworkSnapshot.upsert({
      where: { round },
      update: {},
      create: {
        round,
        totalBonded: `${(500000000 + i * 1000000)}000000000000000000`,
        participationRate: 0.55 + (Math.random() * 0.1 - 0.05),
        inflation: `${(2000 + i * 10)}000000000000000000`,
        activeOrchestrators: 80 + Math.floor(Math.random() * 10),
        avgRewardCut: 12.5 + (Math.random() * 3 - 1.5),
        avgFeeShare: 42.0 + (Math.random() * 5 - 2.5),
        snapshotAt,
      },
    });
  }
  console.log('  30 network snapshots seeded');

  // 9. Governance proposals + votes (S18)
  const proposals = [
    { proposalId: 1n, title: 'LIP-89: Increase Inflation Rate', status: 'passed' },
    { proposalId: 2n, title: 'LIP-91: Treasury Diversification', status: 'active' },
    { proposalId: 3n, title: 'LIP-92: Fee Burn Mechanism', status: 'active' },
    { proposalId: 4n, title: 'LIP-87: Reduce Unbonding Period', status: 'defeated' },
  ];

  for (const p of proposals) {
    const proposal = await prisma.walletGovernanceProposal.upsert({
      where: { proposalId: p.proposalId },
      update: { status: p.status },
      create: {
        proposalId: p.proposalId,
        title: p.title,
        description: `Description for ${p.title}`,
        status: p.status,
        votesFor: '1500000000000000000000000',
        votesAgainst: '500000000000000000000000',
      },
    });

    // Add votes from first 3 orchestrators
    for (const o of orchestrators.slice(0, 3)) {
      await prisma.walletGovernanceVote.upsert({
        where: { proposalId_orchestratorAddr: { proposalId: proposal.id, orchestratorAddr: o.address } },
        update: {},
        create: {
          proposalId: proposal.id,
          orchestratorAddr: o.address,
          support: Math.random() > 0.3,
          weight: o.totalStake,
        },
      });
    }
  }
  console.log('  4 governance proposals + 12 votes seeded');

  // 10. Watchlist entries (S15)
  for (const o of orchestrators.slice(1, 4)) {
    await prisma.walletWatchlist.upsert({
      where: { userId_orchestratorAddr: { userId: user.id, orchestratorAddr: o.address } },
      update: {},
      create: {
        userId: user.id,
        orchestratorAddr: o.address,
        label: `Watching: ${o.name}`,
        notes: 'Monitoring performance before delegating',
      },
    });
  }
  console.log('  3 watchlist entries seeded');

  // 11. Staking snapshots (for yield calculations)
  for (let i = 0; i < 30; i++) {
    const round = baseRound + i * 3;
    const snapshotAt = new Date(now - i * 86400000);
    const bondedBase = 5000 + i * 2;

    await prisma.walletStakingSnapshot.create({
      data: {
        walletAddressId: addr1.id,
        orchestratorAddr: orchestrators[0].address,
        bondedAmount: `${bondedBase}000000000000000000`,
        pendingStake: `${Math.floor(bondedBase * 0.02)}000000000000000000`,
        pendingFees: `${Math.floor(Math.random() * 10)}000000000000000`,
        round,
        snapshotAt,
      },
    }).catch(() => {}); // ignore duplicates
  }
  console.log('  30 staking snapshots seeded');

  // 12. Price cache
  await prisma.walletPriceCache.create({
    data: {
      symbol: 'LPT',
      priceUsd: '12.50',
      source: 'coingecko',
    },
  }).catch(() => {});
  await prisma.walletPriceCache.create({
    data: {
      symbol: 'ETH',
      priceUsd: '3200.00',
      source: 'coingecko',
    },
  }).catch(() => {});
  console.log('  Price cache seeded');

  // 13. Auto-claim config (S17)
  await prisma.walletAutoClaimConfig.upsert({
    where: { walletAddressId: addr1.id },
    update: {},
    create: {
      walletAddressId: addr1.id,
      enabled: true,
      minRewardLpt: '100000000000000000000', // 100 LPT
    },
  });
  console.log('  Auto-claim config seeded');

  // 14. Alerts
  const alert = await prisma.walletAlert.create({
    data: {
      userId: user.id,
      type: 'reward_cut_change',
      orchestratorAddr: orchestrators[0].address,
      threshold: JSON.stringify({ maxCut: 15 }),
      enabled: true,
    },
  }).catch(() => null);

  if (alert) {
    await prisma.walletAlertHistory.create({
      data: {
        alertId: alert.id,
        message: `${orchestrators[0].name} reward cut changed from 8% to 10%`,
        data: JSON.stringify({ oldCut: 8, newCut: 10 }),
      },
    });
    console.log('  Alert + history seeded');
  }

  console.log('\nWallet seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

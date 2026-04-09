/**
 * Build-Time Discovery Plan Seed
 *
 * Seeds demo Discovery Plans into the database so preview deployments
 * have data to test the leaderboard UI.
 *
 * Idempotent — skips plans whose billingPlanId already exists.
 *
 * Required env vars:
 *   DATABASE_URL - Postgres connection string
 *
 * Usage:
 *   npx tsx bin/seed-discovery-plans.ts
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';

const SYSTEM_OWNER_ID = '00000000-0000-0000-0000-000000000001';

interface DemoPlan {
  billingPlanId: string;
  name: string;
  capabilities: string[];
  topN: number;
  slaWeights?: Record<string, number>;
  slaMinScore?: number;
  sortBy?: string;
  filters?: Record<string, number>;
}

const DEMO_PLANS: DemoPlan[] = [
  {
    billingPlanId: 'demo-high-perf-video',
    name: 'High-Performance Video',
    capabilities: ['image-to-video'],
    topN: 10,
    slaWeights: { latency: 0.6, swapRate: 0.2, price: 0.2 },
    slaMinScore: 0.7,
    sortBy: 'latency',
    filters: { maxAvgLatencyMs: 500 },
  },
  {
    billingPlanId: 'demo-budget-image',
    name: 'Budget Image Generation',
    capabilities: ['image-to-image', 'text-to-image'],
    topN: 20,
    slaWeights: { latency: 0.2, swapRate: 0.2, price: 0.6 },
    slaMinScore: 0.3,
    sortBy: 'price',
  },
  {
    billingPlanId: 'demo-balanced-stream',
    name: 'Balanced Streaming',
    capabilities: ['streamdiffusion', 'streamdiffusion-sdxl'],
    topN: 15,
    slaWeights: { latency: 0.34, swapRate: 0.33, price: 0.33 },
    slaMinScore: 0.5,
    sortBy: 'slaScore',
  },
  {
    billingPlanId: 'demo-max-avail',
    name: 'Maximum Availability',
    capabilities: ['noop', 'streamdiffusion', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'],
    topN: 50,
    sortBy: 'avail',
  },
];

async function main() {
  console.log('[seed-plans] Seeding discovery plans...');

  const prisma = new PrismaClient();

  try {
    let ownerUserId = SYSTEM_OWNER_ID;
    const existingUser = await prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existingUser) {
      ownerUserId = existingUser.id;
      console.log(`[seed-plans] Using existing user: ${ownerUserId}`);
    } else {
      console.log(`[seed-plans] No users found — using system owner ID`);
    }

    const existingPlans = await prisma.discoveryPlan.findMany({
      select: { billingPlanId: true },
    });
    const existingIds = new Set(existingPlans.map((p) => p.billingPlanId));

    let created = 0;
    let skipped = 0;

    for (const demo of DEMO_PLANS) {
      if (existingIds.has(demo.billingPlanId)) {
        skipped++;
        continue;
      }

      await prisma.discoveryPlan.create({
        data: {
          billingPlanId: demo.billingPlanId,
          name: demo.name,
          capabilities: demo.capabilities,
          topN: demo.topN,
          slaWeights: demo.slaWeights ?? undefined,
          slaMinScore: demo.slaMinScore ?? undefined,
          sortBy: demo.sortBy ?? undefined,
          filters: demo.filters ?? undefined,
          ownerUserId,
          enabled: true,
        },
      });
      console.log(`[seed-plans] Created: ${demo.name} (${demo.billingPlanId})`);
      created++;
    }

    console.log(`[seed-plans] Done — created: ${created}, skipped: ${skipped}, total: ${existingPlans.length + created}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-plans] Failed:', err.message || err);
  process.exit(1);
});

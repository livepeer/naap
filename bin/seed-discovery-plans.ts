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

interface DemoPlanTemplate {
  slug: string;
  name: string;
  capabilities: string[];
  topN: number;
  slaWeights?: Record<string, number>;
  slaMinScore?: number;
  sortBy?: string;
  filters?: Record<string, number>;
}

const DEMO_PLAN_TEMPLATES: DemoPlanTemplate[] = [
  {
    slug: 'high-perf-video',
    name: 'High-Performance Video',
    capabilities: ['image-to-video'],
    topN: 10,
    slaWeights: { latency: 0.6, swapRate: 0.2, price: 0.2 },
    slaMinScore: 0.7,
    sortBy: 'latency',
    filters: { maxAvgLatencyMs: 500 },
  },
  {
    slug: 'budget-image',
    name: 'Budget Image Generation',
    capabilities: ['image-to-image', 'text-to-image'],
    topN: 20,
    slaWeights: { latency: 0.2, swapRate: 0.2, price: 0.6 },
    slaMinScore: 0.3,
    sortBy: 'price',
  },
  {
    slug: 'balanced-stream',
    name: 'Balanced Streaming',
    capabilities: ['streamdiffusion', 'streamdiffusion-sdxl'],
    topN: 15,
    slaWeights: { latency: 0.34, swapRate: 0.33, price: 0.33 },
    slaMinScore: 0.5,
    sortBy: 'slaScore',
  },
  {
    slug: 'max-avail',
    name: 'Maximum Availability',
    capabilities: ['noop', 'streamdiffusion', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'],
    topN: 50,
    sortBy: 'avail',
  },
];

function userPlanId(userId: string, slug: string): string {
  return `demo-${userId.slice(0, 8)}-${slug}`;
}

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

    // The plans API scopes queries by teamId (using the "personal:{userId}"
    // convention) when the caller authenticates via JWT. Without setting
    // teamId here, the runtime scopeWhere filter would never match these
    // rows, making them invisible to logged-in users.
    const teamId = `personal:${ownerUserId}`;

    const existingPlans = await prisma.discoveryPlan.findMany({
      where: { ownerUserId },
      select: { billingPlanId: true },
    });
    const existingIds = new Set(existingPlans.map((p) => p.billingPlanId));

    let created = 0;
    let skipped = 0;

    for (const tpl of DEMO_PLAN_TEMPLATES) {
      const billingPlanId = userPlanId(ownerUserId, tpl.slug);
      if (existingIds.has(billingPlanId)) {
        skipped++;
        continue;
      }

      await prisma.discoveryPlan.create({
        data: {
          billingPlanId,
          name: tpl.name,
          capabilities: tpl.capabilities,
          topN: tpl.topN,
          slaWeights: tpl.slaWeights ?? undefined,
          slaMinScore: tpl.slaMinScore ?? undefined,
          sortBy: tpl.sortBy ?? undefined,
          filters: tpl.filters ?? undefined,
          ownerUserId,
          teamId,
          enabled: true,
        },
      });
      console.log(`[seed-plans] Created: ${tpl.name} (${billingPlanId})`);
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

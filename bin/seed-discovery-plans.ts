/**
 * Build-Time Discovery Plan Seed
 *
 * Seeds public Discovery Plans into the database as admin defaults.
 * These plans are visible to ALL signed-in users (visibility: 'public').
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

interface DefaultPlanTemplate {
  slug: string;
  name: string;
  description: string;
  capabilities: string[];
  topN: number;
  slaWeights?: Record<string, number>;
  slaMinScore?: number;
  sortBy?: string;
  filters?: Record<string, number>;
}

const DEFAULT_PLAN_TEMPLATES: DefaultPlanTemplate[] = [
  {
    slug: 'high-perf-video',
    name: 'High-Performance Video',
    description: 'Top 10 orchestrators optimized for low-latency video generation.',
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
    description: 'Top 20 most cost-effective orchestrators for image generation.',
    capabilities: ['image-to-image', 'text-to-image'],
    topN: 20,
    slaWeights: { latency: 0.2, swapRate: 0.2, price: 0.6 },
    slaMinScore: 0.3,
    sortBy: 'price',
  },
  {
    slug: 'balanced-stream',
    name: 'Balanced Streaming',
    description: 'Top 15 orchestrators with balanced latency, stability, and pricing for streaming.',
    capabilities: ['streamdiffusion', 'streamdiffusion-sdxl'],
    topN: 15,
    slaWeights: { latency: 0.34, swapRate: 0.33, price: 0.33 },
    slaMinScore: 0.5,
    sortBy: 'slaScore',
  },
  {
    slug: 'max-avail',
    name: 'Maximum Availability',
    description: 'All available orchestrators across common capabilities, sorted by availability.',
    capabilities: ['noop', 'streamdiffusion', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'],
    topN: 50,
    sortBy: 'avail',
  },
];

function defaultPlanId(slug: string): string {
  return `naap-default-${slug}`;
}

async function main() {
  console.log('[seed-plans] Seeding public default discovery plans...');

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
      where: { visibility: 'public' },
      select: { billingPlanId: true },
    });
    const existingIds = new Set(existingPlans.map((p) => p.billingPlanId));

    let created = 0;
    let skipped = 0;

    for (const tpl of DEFAULT_PLAN_TEMPLATES) {
      const billingPlanId = defaultPlanId(tpl.slug);
      if (existingIds.has(billingPlanId)) {
        skipped++;
        continue;
      }

      await prisma.discoveryPlan.create({
        data: {
          billingPlanId,
          name: tpl.name,
          description: tpl.description,
          visibility: 'public',
          capabilities: tpl.capabilities,
          topN: tpl.topN,
          slaWeights: tpl.slaWeights ?? undefined,
          slaMinScore: tpl.slaMinScore ?? undefined,
          sortBy: tpl.sortBy ?? undefined,
          filters: tpl.filters ?? undefined,
          ownerUserId,
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

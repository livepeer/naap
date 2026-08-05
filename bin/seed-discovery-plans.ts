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
  /** Defaults to pymthouse when omitted (legacy templates). */
  billingProviderSlug?: 'daydream' | 'pymthouse';
  slaWeights?: Record<string, number>;
  slaMinScore?: number;
  sortBy?: string;
  filters?: Record<string, number>;
}

/** Keep in sync with STORYBOARD_DEFAULT_PLAN / SIGNER_BUNDLE_DEFAULTS. */
const DAYDREAM_BYOC_CAPS = [
  'nano-banana',
  'recraft-v4',
  'flux-schnell',
  'flux-dev',
  'ltx-t2v',
  'ltx-i2v',
  'kontext-edit',
  'bg-remove',
  'topaz-upscale',
  'chatterbox-tts',
  'gemini-image',
  'gemini-text',
  'ffmpeg-concat',
  'ffmpeg-trim',
  'ffmpeg-overlay',
  'ffmpeg-export',
  'ffmpeg-audio-mix',
  'ffmpeg-loop',
  'ffmpeg-burn-subtitles',
  'ffmpeg-grid',
  'ffmpeg-mux',
  'pillow-resize',
  'pillow-watermark',
  'pillow-format',
  'pillow-palette',
  'pillow-grid',
  'obscura-extract-text',
  'obscura-extract-markdown',
  'obscura-extract-links',
  'hyperframes-caption',
  'hyperframes-lower-third',
  'hyperframes-render',
  'yolo-detect',
  'yolo-segment',
  'cad-render',
  'cad-validate',
];

const PYMTHOUSE_LR_CAPS = [
  'flux-dev',
  'flux-schnell',
  'gpt-image',
  'kontext-edit',
  'pixverse-i2v',
  'seedance-mini-i2v',
  'veo-t2v',
  'chatterbox-tts',
];

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
  {
    slug: 'daydream-byoc',
    name: 'Daydream Signer · BYOC / Tool',
    description:
      'Orchestrators for the Daydream remote-signer path (BYOC + tool hosts). ' +
      'Same shortlist as /bundles/daydream-byoc/python-gateway — set DISCOVERY_URL to this plan’s python-gateway URL.',
    capabilities: DAYDREAM_BYOC_CAPS,
    topN: 100,
    billingProviderSlug: 'daydream',
    sortBy: 'slaScore',
  },
  {
    slug: 'pymthouse-live-runner',
    name: 'pymthouse Signer · Live Runner',
    description:
      'Orchestrators for the pymthouse per-key remote-signer path (Live Runner hosts). ' +
      'Same shortlist as /bundles/pymthouse-live-runner/python-gateway — set DISCOVERY_URL to this plan’s python-gateway URL.',
    capabilities: PYMTHOUSE_LR_CAPS,
    topN: 100,
    billingProviderSlug: 'pymthouse',
    sortBy: 'slaScore',
  },
];

function defaultPlanId(slug: string): string {
  return `naap-default-${slug}`;
}

async function backfillBillingProviderSlugs(
  prisma: PrismaClient,
): Promise<number> {
  // Backfill legacy null slugs to pymthouse so they align with newly seeded
  // defaults (also pymthouse). We intentionally do NOT blanket-convert
  // existing pymthouse plans to daydream — that would fight operator intent and
  // diverge from default plan creation below.
  const nullResult = await prisma.discoveryPlan.updateMany({
    where: { billingProviderSlug: null },
    data: { billingProviderSlug: 'pymthouse' },
  });
  if (nullResult.count > 0) {
    console.log(
      `[seed-plans] Backfilled billingProviderSlug=pymthouse on ${nullResult.count} legacy plan(s)`,
    );
  }

  return nullResult.count;
}

async function main() {
  console.log('[seed-plans] Seeding public default discovery plans...');

  const prisma = new PrismaClient();

  try {
    await backfillBillingProviderSlugs(prisma);
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
          billingProviderSlug: tpl.billingProviderSlug ?? 'pymthouse',
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
          teamId,
          enabled: true,
        },
      });
      console.log(`[seed-plans] Created: ${tpl.name} (${billingPlanId})`);
      created++;
    }

    // Keep signer-bundle plans in sync if they already exist (capabilities /
    // provider / description may evolve with STORYBOARD_DEFAULT_PLAN).
    let updated = 0;
    for (const tpl of DEFAULT_PLAN_TEMPLATES) {
      if (tpl.slug !== 'daydream-byoc' && tpl.slug !== 'pymthouse-live-runner') {
        continue;
      }
      const billingPlanId = defaultPlanId(tpl.slug);
      if (!existingIds.has(billingPlanId)) continue;
      await prisma.discoveryPlan.update({
        where: { billingPlanId },
        data: {
          name: tpl.name,
          description: tpl.description,
          billingProviderSlug: tpl.billingProviderSlug ?? 'pymthouse',
          capabilities: tpl.capabilities,
          topN: tpl.topN,
          sortBy: tpl.sortBy ?? undefined,
          enabled: true,
          visibility: 'public',
        },
      });
      console.log(`[seed-plans] Updated: ${tpl.name} (${billingPlanId})`);
      updated++;
    }

    console.log(
      `[seed-plans] Done — created: ${created}, skipped: ${skipped}, updated: ${updated}, ` +
        `total: ${existingPlans.length + created}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-plans] Failed:', err.message || err);
  process.exit(1);
});

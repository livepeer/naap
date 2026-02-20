/**
 * Prisma Seed Script
 *
 * Seeds reference/catalog data that must exist for the platform to function.
 * Safe to run multiple times (uses upserts).
 *
 * Run: npx tsx prisma/seed.ts
 *   or: npm run db:seed
 */

import { PrismaClient } from '../src/generated/client';
import { BILLING_PROVIDERS } from '../src/billing-providers.js';

const prisma = new PrismaClient();

async function seedBillingProviders() {
  console.log('[seed] Seeding billing providers...');

  for (const provider of BILLING_PROVIDERS) {
    await prisma.billingProvider.upsert({
      where: { slug: provider.slug },
      update: {
        displayName: provider.displayName,
        description: provider.description,
        icon: provider.icon,
        authType: provider.authType,
        enabled: provider.enabled,
        sortOrder: provider.sortOrder,
      },
      create: provider,
    });
    console.log(`[seed]   - ${provider.displayName} (${provider.slug})`);
  }
}

async function main() {
  console.log('[seed] Starting database seed...');
  await seedBillingProviders();
  console.log('[seed] Done.');
}

main()
  .catch((err) => {
    console.error('[seed] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

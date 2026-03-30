/**
 * Seed Script: Public Connectors (standalone runner)
 *
 * Thin wrapper around the shared seedPublicConnectors() function
 * (plugins/service-gateway/connectors/seed.ts).
 *
 * The DB seeding itself runs as part of the standard Prisma seed
 * (apps/web-next/prisma/seed.ts, section 14). This script exists
 * for manual re-runs outside of the normal seed pipeline.
 *
 * Upstream secrets (API keys etc.) are resolved from environment
 * variables at runtime by the server backend — they are never
 * stored in the database.
 *
 * Usage:
 *   npx tsx bin/seed-public-connectors.ts
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';
import { seedPublicConnectors } from '../plugins/service-gateway/connectors/seed.js';

const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@livepeer.org';

async function main() {
  const prisma = new PrismaClient();

  const seedUser =
    (await prisma.user.findFirst({ where: { email: AUTH_EMAIL }, select: { id: true, email: true } })) ??
    (await prisma.user.findFirst({ select: { id: true, email: true } }));
  if (!seedUser) {
    throw new Error('No users found in database. Run base DB seed first.');
  }

  console.log(`\n  Public Connectors — using owner: ${seedUser.email ?? seedUser.id}`);

  const result = await seedPublicConnectors(prisma, seedUser.id);
  console.log(`  Done: ${result.total} connectors (${result.created} created, ${result.existing} existing)\n`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('\n  Seed failed:', err.message || err);
  process.exit(1);
});

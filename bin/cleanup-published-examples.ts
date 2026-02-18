#!/usr/bin/env npx tsx
/**
 * Remove published example plugins from marketplace (restore pre-publish state).
 * Run after E2E plugin publisher tests.
 */

import { prisma } from '@naap/database';

const EXAMPLE_NAMES = [
  'daydream-video',
  'gateway-manager',
  'hello-world',
  'my-dashboard',
  'my-wallet',
  'network-analytics',
  'orchestrator-manager',
  'todo-list',
];

async function main() {
  for (const name of EXAMPLE_NAMES) {
    const pkg = await prisma.pluginPackage.findUnique({ where: { name } });
    if (pkg) {
      await prisma.pluginVersion.deleteMany({ where: { packageId: pkg.id } });
      await prisma.pluginPackage.delete({ where: { id: pkg.id } });
      console.log(`Removed: ${name}`);
    } else {
      console.log(`Not found (already clean): ${name}`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

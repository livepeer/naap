#!/usr/bin/env npx tsx
/**
 * Remove published example plugins from marketplace (restore pre-publish state).
 * Run after E2E plugin publisher tests.
 */

import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@naap/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, '..', 'examples');

const EXAMPLE_NAMES = readdirSync(examplesDir)
  .filter(name => existsSync(join(examplesDir, name, 'plugin.json')))
  .sort();

async function main() {
  try {
    for (const name of EXAMPLE_NAMES) {
      const pkg = await prisma.pluginPackage.findUnique({ where: { name } });
      if (pkg) {
        await prisma.$transaction([
          prisma.pluginVersion.deleteMany({ where: { packageId: pkg.id } }),
          prisma.pluginPackage.delete({ where: { id: pkg.id } }),
        ]);
        console.log(`Removed: ${name}`);
      } else {
        console.log(`Not found (already clean): ${name}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

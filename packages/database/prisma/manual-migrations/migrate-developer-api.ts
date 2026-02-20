/**
 * Migration: Developer API schema changes
 *
 * Consolidates all DevApiKey / DevApiProject backfills into a single
 * idempotent script.  Run once against production after PR 1 (expand)
 * has been deployed.
 *
 * Steps:
 *   1. Backfill keyLookupId for existing rows
 *   2. Backfill billingProviderId (assign daydream provider to orphans)
 *   3. Normalize legacy keyPrefix values to canonical "12-char..." format
 *   4. Create DevApiProject rows from distinct (userId, projectName)
 *      and backfill DevApiKey.projectId
 *
 * Run: npx tsx prisma/manual-migrations/migrate-developer-api.ts
 *
 * After running, deploy PR 3 to enforce constraints.
 */

import * as crypto from 'crypto';
import { PrismaClient } from '../../src/generated/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Step 1 – keyLookupId on DevApiKey
// ---------------------------------------------------------------------------
async function backfillKeyLookupId() {
  console.log('[migrate] Step 1: backfill keyLookupId');

  const rows: Array<{ id: string }> = await prisma.$queryRaw`
    SELECT id FROM "plugin_developer_api"."DevApiKey"
    WHERE "keyLookupId" IS NULL
  `;

  if (rows.length > 0) {
    console.log(`[migrate]   Backfilling ${rows.length} rows...`);
    for (const row of rows) {
      const lookupId = crypto.randomBytes(8).toString('hex');
      await prisma.$executeRaw`
        UPDATE "plugin_developer_api"."DevApiKey"
        SET "keyLookupId" = ${lookupId}
        WHERE id = ${row.id}
      `;
    }
  } else {
    console.log('[migrate]   All rows already have keyLookupId.');
  }
}

// ---------------------------------------------------------------------------
// Step 2 – billingProviderId on DevApiKey
// ---------------------------------------------------------------------------
async function backfillBillingProviderId() {
  console.log('[migrate] Step 2: backfill billingProviderId');

  const daydreamProvider = await prisma.billingProvider.findUnique({
    where: { slug: 'daydream' },
  });

  if (!daydreamProvider) {
    console.error('[migrate]   ERROR: daydream BillingProvider not found. Run seed first.');
    process.exit(1);
  }

  const orphanFixed = await prisma.$executeRaw`
    UPDATE "plugin_developer_api"."DevApiKey"
    SET "billingProviderId" = ${daydreamProvider.id}
    WHERE "billingProviderId" IS NULL
  `;
  if (orphanFixed > 0) {
    console.log(`[migrate]   Assigned daydream provider to ${orphanFixed} rows.`);
  } else {
    console.log('[migrate]   All rows already have billingProviderId.');
  }
}

// ---------------------------------------------------------------------------
// Step 3 – Normalize legacy keyPrefix masks
// ---------------------------------------------------------------------------
async function normalizeKeyPrefixes() {
  console.log('[migrate] Step 3: normalize keyPrefix values');

  const keys: Array<{ id: string; keyPrefix: string }> = await prisma.$queryRaw`
    SELECT id, "keyPrefix" FROM "plugin_developer_api"."DevApiKey"
    WHERE "keyPrefix" LIKE '%*%'
       OR "keyPrefix" LIKE '%****************%'
  `;

  let updated = 0;
  for (const key of keys) {
    const visible = key.keyPrefix.replace(/\*+$/, '').substring(0, 12);
    const newPrefix = visible + '...';
    if (newPrefix !== key.keyPrefix) {
      await prisma.$executeRaw`
        UPDATE "plugin_developer_api"."DevApiKey"
        SET "keyPrefix" = ${newPrefix}
        WHERE id = ${key.id}
      `;
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[migrate]   Normalized ${updated} keyPrefix values.`);
  } else {
    console.log('[migrate]   All keyPrefix values already canonical.');
  }
}

// ---------------------------------------------------------------------------
// Step 4 – Create DevApiProject rows and backfill projectId
// ---------------------------------------------------------------------------
async function backfillProjects() {
  console.log('[migrate] Step 4: backfill DevApiProject + projectId');

  const distinct: Array<{ userId: string; projectName: string }> = await prisma.$queryRaw`
    SELECT DISTINCT "userId", "projectName"
    FROM "plugin_developer_api"."DevApiKey"
    WHERE "projectId" IS NULL
  `;

  if (distinct.length === 0) {
    console.log('[migrate]   All keys already have projectId.');
    return;
  }

  console.log(`[migrate]   Found ${distinct.length} distinct (userId, projectName) pairs.`);

  for (const { userId, projectName } of distinct) {
    const isFirst = !(await prisma.devApiProject.findFirst({
      where: { userId },
      select: { id: true },
    }));

    const project = await prisma.devApiProject.upsert({
      where: { userId_name: { userId, name: projectName } },
      update: {},
      create: {
        userId,
        name: projectName,
        isDefault: isFirst,
      },
    });

    const filled = await prisma.$executeRaw`
      UPDATE "plugin_developer_api"."DevApiKey"
      SET "projectId" = ${project.id}
      WHERE "userId" = ${userId}
        AND "projectName" = ${projectName}
        AND "projectId" IS NULL
    `;
    console.log(`[migrate]   ${userId}/${projectName} → project ${project.id} (${filled} keys)`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('[migrate] Starting developer-api backfill migration...');
  await backfillKeyLookupId();
  await backfillBillingProviderId();
  await normalizeKeyPrefixes();
  await backfillProjects();
  console.log('[migrate] Done. Verify all rows have non-null values, then deploy PR 3.');
}

main()
  .catch((err) => {
    console.error('[migrate] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

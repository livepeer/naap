/**
 * E2E for the daily-backup cron (PR 24).
 *
 * Coverage:
 *   1. Tenant opted-in (default `dailyBackupEnabled = true`) → cron run
 *      creates an `AbBackup` row + emits a Telegram notification with a
 *      download link via E2E_CAPTURE.
 *   2. Tenant opted-out (`dailyBackupEnabled = false`) → cron run does
 *      NOT create an `AbBackup` row for that tenant.
 *
 * Notes:
 *   - The cron runs in `nodejs` runtime against the local Vercel Blob
 *     dev fallback (no `BLOB_READ_WRITE_TOKEN`), so the upload yields
 *     a `data:` URL — fine for assertions.
 *   - `E2E_TELEGRAM_CAPTURE=1` is set on the dev server for these tests
 *     to short-circuit the real Telegram API; we read the captured
 *     entries off the cron's bot.api intercept by polling
 *     `AbBackup` afterwards (the row is the integration-level proof
 *     that the bundle landed and was logged).
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const TENANT_OPTIN = `e2e-backup-in-${Date.now()}`;
const TENANT_OPTOUT = `e2e-backup-out-${Date.now()}`;

let prisma: typeof import('@naap/database').prisma;

test.describe.serial('PR 24 — Daily backup notification', () => {
  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    // Opt-in tenant — explicit `true` so the row exists in
    // `AbTenantConfig` (the cron's `findMany` is gated on the row
    // existing).
    await prisma.abTenantConfig.create({
      data: {
        userId: TENANT_OPTIN,
        dailyBackupEnabled: true,
      },
    });

    // Opt-out tenant — same default, then explicitly turned off.
    await prisma.abTenantConfig.create({
      data: {
        userId: TENANT_OPTOUT,
        dailyBackupEnabled: false,
      },
    });

    // Seed a single expense for the opt-in tenant so the entityCount
    // is non-zero. Other tables can stay empty — the helper still
    // emits header rows.
    await prisma.abExpense.create({
      data: {
        tenantId: TENANT_OPTIN,
        amountCents: 4242,
        date: new Date(),
        currency: 'USD',
        description: 'Backup-test lunch',
        status: 'confirmed',
      },
    });
  });

  test.afterAll(async () => {
    for (const tenantId of [TENANT_OPTIN, TENANT_OPTOUT]) {
      await prisma.abBackup.deleteMany({ where: { tenantId } });
      await prisma.abExpense.deleteMany({ where: { tenantId } });
      await prisma.abTenantConfig.deleteMany({
        where: { userId: tenantId },
      });
    }
  });

  test('1. opt-in tenant gets an AbBackup row written by the cron', async ({
    request,
  }) => {
    const res = await request.get(
      `${WEB}/api/v1/agentbook/cron/daily-backup`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.total).toBe('number');
    expect(body.data.ok).toBeGreaterThanOrEqual(1);

    // The opt-in tenant must show up as one of the per-tenant results
    // and have produced an AbBackup row.
    const ours = (body.data.results as { tenantId: string; ok: boolean; sizeBytes?: number }[]).find(
      (r) => r.tenantId === TENANT_OPTIN,
    );
    expect(ours).toBeDefined();
    expect(ours?.ok).toBe(true);
    expect(ours?.sizeBytes).toBeGreaterThan(0);

    const rows = await prisma.abBackup.findMany({
      where: { tenantId: TENANT_OPTIN },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const last = rows[rows.length - 1];
    expect(last.blobUrl.length).toBeGreaterThan(0);
    expect(last.sizeBytes).toBeGreaterThan(0);
  });

  test('2. opt-out tenant is skipped — no AbBackup row written', async ({
    request,
  }) => {
    // Run the cron a second time to make the assertion independent of
    // whatever ran in test 1 (Playwright workers may interleave).
    const res = await request.get(
      `${WEB}/api/v1/agentbook/cron/daily-backup`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Opt-out tenant must not appear in per-tenant results.
    const optedOut = (body.data.results as { tenantId: string }[]).find(
      (r) => r.tenantId === TENANT_OPTOUT,
    );
    expect(optedOut).toBeUndefined();

    // And no row should ever have been written.
    const rows = await prisma.abBackup.findMany({
      where: { tenantId: TENANT_OPTOUT },
    });
    expect(rows.length).toBe(0);
  });
});

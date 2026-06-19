/**
 * TEMPORARY integration-seed endpoint (preview-only; never merged to main).
 *
 *   POST /api/v1/internal/int-seed
 *   header: x-int-seed-secret: <INT_SEED_SECRET>
 *
 * Seeds the flags-ON integration round against the isolated Neon PREVIEW branch:
 *  - turns the 8 integration feature flags + enableTeams ON (DB-backed flags)
 *  - upserts the pymthouse BillingProvider (adapterType=pymthouse)
 *  - upserts an owner User + a Team bound to {pymthouse, accountId}
 *  - upserts a Seat for the owner
 *  - mints a native `naap_` key (DevApiKey) bound to the seat/team
 *  - mints a service `gw_` discovery key (GatewayApiKey)
 *  - upserts the Storyboard Application (registry)
 *
 * Returns the raw keys ONCE. Guarded by INT_SEED_SECRET so it is inert unless the
 * operator sets the secret on this preview branch. This file lives only on the
 * `int/flags-on-preview` branch and must NOT be merged to main.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { KNOWN_FLAGS } from '@/lib/feature-flags';
import { encrypt } from '@/lib/gateway/encryption';
import { deriveKeyLookupId, formatBillingKeyPublicPrefix, hashApiKey } from '@naap/database';
import { generateNativeApiKey } from '@/lib/dev-api/native-key';
import { mintServiceDiscoveryKey } from '@/lib/gateway/service-key';

const INTEGRATION_FLAGS = [
  'provider_adapters',
  'team_seats',
  'native_keys',
  'key_validation_front_door',
  'app_registry',
  'usage_ingest',
  'capability_gate',
  'db_adapter_registry',
  'enableTeams',
] as const;

function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

/**
 * GET readback (preview-only, same guard): summarize the ingested BPP ⑥
 * ProviderUsageRecord rows so the integration round can evidence the
 * `/metrics/ingest` → spend data-source without a browser session. Returns
 * counts + a small sample; never secrets/PII.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.INT_SEED_SECRET;
  if (!secret || request.headers.get('x-int-seed-secret') !== secret) {
    return notFound();
  }
  try {
    const total = await prisma.providerUsageRecord.count();
    const byProvider = await prisma.providerUsageRecord.groupBy({
      by: ['providerSlug'],
      _count: { _all: true },
      _sum: { sessions: true, tickets: true },
    });
    const sample = await prisma.providerUsageRecord.findMany({
      take: 3,
      orderBy: { receivedAt: 'desc' },
      select: {
        providerSlug: true,
        accountId: true,
        appId: true,
        sessions: true,
        tickets: true,
        windowFrom: true,
        windowTo: true,
        receivedAt: true,
      },
    });
    return NextResponse.json({ ok: true, total, byProvider, sample });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'readback_failed' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.INT_SEED_SECRET;
  if (!secret || request.headers.get('x-int-seed-secret') !== secret) {
    // Behave as if the route does not exist when the guard is unset/mismatched.
    return notFound();
  }

  try {
    const accountId = process.env.INT_SEED_ACCOUNT_ID?.trim() || 'naap-int-e2e-user';
    const ownerEmail = process.env.INT_SEED_OWNER_EMAIL?.trim() || 'admin@livepeer.org';

    // 0. Self-heal schema. The Neon PREVIEW branch can be reset to a snapshot
    //    that predates the latest (Jun 18) additive migrations. These mirror
    //    packages/database/prisma/migrations/*_naap2_team_billing_account_ref and
    //    *_provider_usage_record_idempotency verbatim and are idempotent
    //    (IF NOT EXISTS), so re-applying is a safe no-op when already migrated.
    const ensureSchema: string[] = [
      'ALTER TABLE "public"."Team" ADD COLUMN IF NOT EXISTS "billingAccountProviderSlug" TEXT',
      'ALTER TABLE "public"."Team" ADD COLUMN IF NOT EXISTS "billingAccountId" TEXT',
      'CREATE INDEX IF NOT EXISTS "Team_billingAccountProviderSlug_idx" ON "public"."Team"("billingAccountProviderSlug")',
      'CREATE UNIQUE INDEX IF NOT EXISTS "ProviderUsageRecord_window_key" ON "public"."ProviderUsageRecord" ("providerSlug", "accountId", "appId", "windowFrom", "windowTo")',
    ];
    for (const stmt of ensureSchema) {
      await prisma.$executeRawUnsafe(stmt);
    }

    // 1. Feature flags ON (DB-backed). Preserve descriptions from KNOWN_FLAGS.
    for (const key of INTEGRATION_FLAGS) {
      const known = KNOWN_FLAGS.find((f) => f.key === key);
      await prisma.featureFlag.upsert({
        where: { key },
        update: { enabled: true },
        create: { key, enabled: true, description: known?.description ?? `integration flag ${key}` },
      });
    }

    // 2. Owner user (team owner + key owner).
    let user = await prisma.user.findUnique({ where: { email: ownerEmail } });
    if (!user) {
      user = await prisma.user.create({
        data: { email: ownerEmail, displayName: 'Integration Admin' },
      });
    }

    // 3. pymthouse BillingProvider (FK target for native keys; adapterType for NAAP-A-db).
    const provider = await prisma.billingProvider.upsert({
      where: { slug: 'pymthouse' },
      update: { enabled: true, adapterType: 'pymthouse' },
      create: {
        slug: 'pymthouse',
        displayName: 'PymtHouse',
        description: 'PymtHouse reference billing provider (integration preview).',
        adapterType: 'pymthouse',
        authType: 'oauth',
        enabled: true,
      },
    });

    // 4. Team bound to {pymthouse, accountId} (NAAP-1 billingAccountRef).
    const team = await prisma.team.upsert({
      where: { slug: 'naap-int' },
      update: {
        ownerId: user.id,
        billingAccountProviderSlug: 'pymthouse',
        billingAccountId: accountId,
      },
      create: {
        slug: 'naap-int',
        name: 'NaaP Integration',
        ownerId: user.id,
        billingAccountProviderSlug: 'pymthouse',
        billingAccountId: accountId,
      },
    });

    // 5. Seat for the owner.
    let seat = await prisma.seat.findFirst({ where: { teamId: team.id, userId: user.id } });
    if (!seat) {
      seat = await prisma.seat.create({
        data: {
          teamId: team.id,
          userId: user.id,
          email: ownerEmail,
          role: 'admin',
          status: 'active',
          keyLimit: 50,
        },
      });
    }

    // 6. Native `naap_` key bound to the seat/team (NAAP-B), mirroring the
    //    seats/keys route exactly (lookupId/prefix/hash + encrypted accountId).
    const { rawKey: naapRaw } = generateNativeApiKey();
    const sessionRef = encrypt(accountId);
    const naapKey = await prisma.devApiKey.create({
      data: {
        userId: user.id,
        billingProviderId: provider.id,
        seatId: seat.id,
        teamId: team.id,
        keyLookupId: deriveKeyLookupId(naapRaw),
        keyPrefix: formatBillingKeyPublicPrefix(naapRaw),
        keyHash: hashApiKey(naapRaw),
        label: 'int-e2e native key',
        status: 'ACTIVE',
        providerSessionRefEnc: sessionRef.encryptedValue,
        providerSessionRefIv: sessionRef.iv,
      },
      select: { id: true, keyPrefix: true },
    });

    // 7. Service `gw_` discovery key (NAAP-4).
    const gw = await mintServiceDiscoveryKey({
      name: 'int-sdk-discovery',
      createdBy: user.id,
      teamId: team.id,
    });

    // 8. Storyboard Application (registry, NAAP-D).
    const app = await prisma.application.upsert({
      where: { slug: 'storyboard' },
      update: {
        status: 'active',
        teamId: team.id,
        allowedScopes: ['discovery', 'gateway', 'llm', 'billing', 'usage'],
        allowedCapabilities: ['*'],
      },
      create: {
        slug: 'storyboard',
        name: 'Storyboard',
        type: 'app',
        teamId: team.id,
        allowedScopes: ['discovery', 'gateway', 'llm', 'billing', 'usage'],
        allowedCapabilities: ['*'],
        status: 'active',
        createdBy: user.id,
      },
    });

    return NextResponse.json({
      ok: true,
      flags: INTEGRATION_FLAGS,
      providerId: provider.id,
      providerSlug: provider.slug,
      userId: user.id,
      teamId: team.id,
      teamSlug: team.slug,
      seatId: seat.id,
      appId: app.id,
      appSlug: app.slug,
      accountId,
      naapKeyId: naapKey.id,
      naapKeyPrefix: naapKey.keyPrefix,
      naapRawKey: naapRaw,
      gwKeyId: gw.id,
      gwKeyPrefix: gw.keyPrefix,
      gwRawKey: gw.rawKey,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'seed_failed' },
      { status: 500 },
    );
  }
}

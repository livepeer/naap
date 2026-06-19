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

import * as crypto from 'node:crypto';

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
  // NAAP-2: spend dashboard PULLS usage live via the provider adapter M2M client.
  'usage_pull',
  'capability_gate',
  'db_adapter_registry',
  'enableTeams',
  // NAAP-5: public `sdk` Service Gateway connector + naap_ key auth at the gateway.
  'sdk_connector',
] as const;

/**
 * NAAP-5 public `sdk` connector definition (mirrors
 * plugins/service-gateway/connectors/sdk.json). Inlined here so the preview seed
 * can create the ServiceConnector row at runtime — the build-time seed
 * (bin/seed-gateway-connector.ts) skips it because the `sdk_connector` flag is
 * only flipped ON later, at runtime, by this route.
 */
const SDK_CONNECTOR = {
  slug: 'sdk',
  displayName: 'SDK Service',
  description:
    'Proxies application requests to the SDK service. Public NaaP Service Gateway connector fronting sdk.daydream.monster (NAAP-5).',
  category: 'ai',
  upstreamBaseUrl: 'https://sdk.daydream.monster',
  allowedHosts: ['sdk.daydream.monster'],
  defaultTimeout: 30000,
  healthCheckPath: '/health',
  authType: 'none',
  authConfig: {},
  secretRefs: [] as string[],
  streamingEnabled: true,
  responseWrapper: false,
  tags: ['sdk', 'daydream', 'inference', 'llm', 'capabilities'],
  endpoints: [
    { name: 'inference', description: 'Run an inference request against the SDK service', method: 'POST', path: '/inference', upstreamPath: '/inference', timeout: 30000, retries: 0 },
    { name: 'capabilities', description: 'List SDK service capabilities', method: 'GET', path: '/capabilities', upstreamPath: '/capabilities', timeout: 15000, cacheTtl: 30, retries: 1 },
    { name: 'llm-chat', description: 'LLM chat completion (streaming-capable)', method: 'POST', path: '/llm/chat', upstreamPath: '/llm/chat', timeout: 60000, retries: 0 },
  ],
} as const;

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

  // Preview-only diagnostic: probe the pymthouse provider mint path directly so
  // we can distinguish "not configured" from a live mint error (the front door
  // collapses both into an opaque 503). Returns the exact error message.
  if (request.nextUrl.searchParams.get('debug') === 'pymthouse') {
    const present = (k: string) => {
      const v = process.env[k];
      return typeof v === 'string' && v.trim().length > 0;
    };
    const out: Record<string, unknown> = {
      env: {
        PYMTHOUSE_ISSUER_URL: present('PYMTHOUSE_ISSUER_URL'),
        PYMTHOUSE_PUBLIC_CLIENT_ID: present('PYMTHOUSE_PUBLIC_CLIENT_ID'),
        PYMTHOUSE_M2M_CLIENT_ID: present('PYMTHOUSE_M2M_CLIENT_ID'),
        PYMTHOUSE_M2M_CLIENT_SECRET: present('PYMTHOUSE_M2M_CLIENT_SECRET'),
        // echo the non-secret id values so we can confirm the exact client id
        m2mClientIdValue: process.env.PYMTHOUSE_M2M_CLIENT_ID ?? null,
        issuerValue: process.env.PYMTHOUSE_ISSUER_URL ?? null,
        publicClientIdValue: process.env.PYMTHOUSE_PUBLIC_CLIENT_ID ?? null,
      },
    };
    try {
      const { isPymthouseConfigured } = await import('@pymthouse/builder-sdk/config');
      out.isPymthouseConfigured = isPymthouseConfigured();
    } catch (e) {
      out.isPymthouseConfigured = `import_failed: ${e instanceof Error ? e.message : 'err'}`;
    }
    const externalUserId =
      request.nextUrl.searchParams.get('externalUserId')?.trim() ||
      process.env.INT_SEED_ACCOUNT_ID?.trim() ||
      'naap-int-e2e-user';
    try {
      const { getPmtHouseServerClient } = await import('@/lib/pymthouse-client');
      const session = await getPmtHouseServerClient().mintSignerSessionForExternalUser({
        externalUserId,
      });
      out.mint = {
        ok: true,
        tokenType: session.tokenType,
        expiresIn: session.expiresIn,
        scope: session.scope,
        accessTokenPrefix: String(session.accessToken).slice(0, 12),
      };
    } catch (e) {
      out.mint = {
        ok: false,
        externalUserId,
        name: e instanceof Error ? e.name : 'unknown',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    return NextResponse.json(out);
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

  // Runtime flag toggle for verification scenarios: flip usage_pull ON/OFF
  // without a redeploy so the integration runner can prove the flag-OFF legacy
  // ProviderUsageRecord read vs. the flag-ON live pull. Preview-only.
  const usagePullParam = request.nextUrl.searchParams.get('usagePull');
  if (usagePullParam === 'on' || usagePullParam === 'off') {
    const enabled = usagePullParam === 'on';
    await prisma.featureFlag.upsert({
      where: { key: 'usage_pull' },
      update: { enabled },
      create: {
        key: 'usage_pull',
        enabled,
        description: KNOWN_FLAGS.find((f) => f.key === 'usage_pull')?.description ?? 'usage_pull',
      },
    });
    return NextResponse.json({ ok: true, usage_pull: enabled });
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

    // 5b. A real Session for the owner so the integration runner can call
    //     session-authenticated BFFs (e.g. GET /api/v1/metrics/usage) headlessly.
    //     tokenHash mirrors lib/api/auth.ts `hmacToken` exactly so validateSession
    //     resolves it. Re-seed clears prior int sessions to stay idempotent.
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const pepper = process.env.SESSION_TOKEN_PEPPER;
    const sessionTokenHash = pepper
      ? crypto.createHmac('sha256', pepper).update(sessionToken).digest('hex')
      : crypto.createHash('sha256').update(sessionToken).digest('hex');
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        tokenHash: sessionTokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        versionAtCreation: user.sessionVersion ?? 0,
      },
    });

    // 5c. A DISTINCT decoy ProviderUsageRecord for {pymthouse, accountId}. The
    //     live pull surfaces 42 tickets / 9000 µ$ from OpenMeter; this stored row
    //     carries deliberately different values (10 tickets / 1234 µ$) so the
    //     verification can prove: pull-first wins (no double-count), flag-OFF
    //     reverts to THIS row, and a forced pull failure falls back to THIS row.
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59));
    await prisma.providerUsageRecord.deleteMany({ where: { providerSlug: 'pymthouse', accountId } });
    await prisma.providerUsageRecord.create({
      data: {
        providerSlug: 'pymthouse',
        accountId,
        appId: '',
        windowFrom: monthStart,
        windowTo: monthEnd,
        sessions: 5,
        tickets: 10,
        feeWei: null,
        networkFeeUsdMicros: '1234',
      },
    });

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

    // 9. NAAP-5: public `sdk` Service Gateway connector (idempotent). The
    //    build-time seed skips this because the `sdk_connector` flag is flipped
    //    ON only at runtime (step 1), so create it here so `/api/v1/gw/sdk/*`
    //    resolves and accepts a `naap_` key when the flag is ON.
    let sdkConnectorId: string | null = null;
    {
      let connector = await prisma.serviceConnector.findFirst({
        where: { slug: SDK_CONNECTOR.slug, visibility: 'public' },
      });
      if (!connector) {
        connector = await prisma.serviceConnector.create({
          data: {
            ownerUserId: user.id,
            createdBy: user.id,
            slug: SDK_CONNECTOR.slug,
            displayName: SDK_CONNECTOR.displayName,
            description: SDK_CONNECTOR.description,
            category: SDK_CONNECTOR.category,
            visibility: 'public',
            upstreamBaseUrl: SDK_CONNECTOR.upstreamBaseUrl,
            allowedHosts: [...SDK_CONNECTOR.allowedHosts],
            defaultTimeout: SDK_CONNECTOR.defaultTimeout,
            healthCheckPath: SDK_CONNECTOR.healthCheckPath,
            authType: SDK_CONNECTOR.authType,
            authConfig: SDK_CONNECTOR.authConfig,
            secretRefs: [...SDK_CONNECTOR.secretRefs],
            streamingEnabled: SDK_CONNECTOR.streamingEnabled,
            responseWrapper: SDK_CONNECTOR.responseWrapper,
            tags: [...SDK_CONNECTOR.tags],
            status: 'published',
            publishedAt: new Date(),
          },
        });
      } else if (connector.status !== 'published') {
        await prisma.serviceConnector.update({
          where: { id: connector.id },
          data: { status: 'published', publishedAt: new Date() },
        });
      }
      sdkConnectorId = connector.id;

      const existingEps = await prisma.connectorEndpoint.findMany({
        where: { connectorId: connector.id },
        select: { path: true, method: true },
      });
      const existingSet = new Set(existingEps.map((e) => `${e.method}:${e.path}`));
      for (const ep of SDK_CONNECTOR.endpoints) {
        if (existingSet.has(`${ep.method}:${ep.path}`)) continue;
        await prisma.connectorEndpoint.create({
          data: {
            connectorId: connector.id,
            name: ep.name,
            description: ep.description,
            method: ep.method,
            path: ep.path,
            upstreamPath: ep.upstreamPath,
            upstreamContentType: 'application/json',
            bodyTransform: 'passthrough',
            timeout: ep.timeout,
            cacheTtl: 'cacheTtl' in ep ? (ep as { cacheTtl?: number }).cacheTtl ?? null : null,
            retries: ep.retries ?? 0,
            bodyBlacklist: [],
          },
        });
      }

      const planName = `${SDK_CONNECTOR.slug}-standard`;
      const existingPlan = await prisma.gatewayPlan.findFirst({
        where: { ownerUserId: user.id, name: planName },
      });
      if (!existingPlan) {
        await prisma.gatewayPlan.create({
          data: {
            ownerUserId: user.id,
            name: planName,
            displayName: `${SDK_CONNECTOR.displayName} Standard`,
            rateLimit: 60,
            dailyQuota: 1000,
          },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      flags: INTEGRATION_FLAGS,
      sdkConnectorId,
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
      // Session bearer for headless session-authed BFF calls (e.g. /metrics/usage).
      sessionToken,
      // The stored decoy row (distinct from the live OpenMeter pull values).
      decoyProviderUsageRecord: { providerSlug: 'pymthouse', accountId, tickets: 10, sessions: 5, networkFeeUsdMicros: '1234' },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'seed_failed' },
      { status: 500 },
    );
  }
}

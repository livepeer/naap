/**
 * TEMPORARY storyboard-integration seed endpoint (preview-only; never merged to main).
 *
 *   POST /api/v1/internal/sb-seed      header: x-int-seed-secret: <INT_SEED_SECRET>
 *   GET  /api/v1/internal/sb-seed      header: x-int-seed-secret: <INT_SEED_SECRET>
 *
 * Built on top of CURRENT main (multi-app billing chain P0–P4 merged). It wires
 * the isolated "storyboard × pymthouse app_98575870…" preview round end-to-end so
 * the full Playwright billing E2E (catalog → subscribe → mint key via the P3 UI →
 * generate via storyboard) can run against a real preview. On purpose this:
 *   - enables ONLY the task flags (multi-app chain + front door), NOT sdk_connector.
 *   - seeds a pymthouse `ProviderInstance` for app_98575870 whose NON-SECRET
 *     config holds {issuerUrl, publicClientId, m2mClientId} and whose M2M secret
 *     is written ENCRYPTED into `SecretVault` (encryptV1, no AAD — matching
 *     getProviderInstanceSecret/decryptV1) and referenced by `secretRef`.
 *   - creates a `storyboard` Team (+ TeamMember owner + Seat) bound to the
 *     pymthouse provider with a subscription-less account => wildcard ["*"].
 *   - runs the P4 plan-spec sync IN-PROCESS (no CRON_SECRET) so the catalog +
 *     per-app DiscoveryPlans populate.
 *   - seeds a loginable owner (email + pbkdf2 passwordHash) so the operator can
 *     sign in to the preview dev-manager and mint a naap_ key via the UI.
 *   - does NOT mint any naap_/gw_ key (operator mints via the UI).
 *   - does NOT create any pymthouse subscription (wildcard requires none).
 *
 * Guarded by INT_SEED_SECRET so it is inert (404) unless the operator sets the
 * secret on this preview branch. Lives only on `int/sb-app98575870-preview`.
 */

export const runtime = 'nodejs';

import * as crypto from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { encryptV1 } from '@naap/crypto';

import { prisma } from '@/lib/db';
import { KNOWN_FLAGS } from '@/lib/feature-flags';
import { syncAllProviderInstancePlans } from '@/lib/billing/plan-spec-sync';

/** Exactly the flags this task requires ON — no more (no sdk_connector). */
const TASK_FLAGS = [
  'enableTeams',
  'team_seats',
  'native_keys',
  'key_validation_front_door',
  'capability_gate',
  'pymthouse_bpp_validate',
  'usage_pull',
  'usage_ingest',
  'db_adapter_registry',
  'provider_instances',
  'multi_subscription',
  'plan_spec_sync',
] as const;

const TEAM_SLUG = 'storyboard';
const PROVIDER_INSTANCE_SLUG = 'pymthouse-app98575870';
const SECRET_VAULT_KEY = 'pymthouse:app98575870:m2m';

function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

function guardOk(request: NextRequest): boolean {
  const secret = process.env.INT_SEED_SECRET;
  return !!secret && request.headers.get('x-int-seed-secret') === secret;
}

/** Mirror lib/api/auth.ts hashPassword (pbkdf2-sha256, 600k, 64 bytes). */
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 600_000, 64, 'sha256').toString('hex');
  return `pbkdf2-sha256-600k:${salt}:${hash}`;
}

/** Mirror lib/api/auth.ts hmacToken for Session.tokenHash. */
function hmacToken(plaintext: string): string {
  const pepper = process.env.SESSION_TOKEN_PEPPER;
  if (!pepper) return crypto.createHash('sha256').update(plaintext).digest('hex');
  return crypto.createHmac('sha256', pepper).update(plaintext).digest('hex');
}

function pymthouseEnv() {
  return {
    issuerUrl: process.env.PYMTHOUSE_ISSUER_URL?.trim() || '',
    publicClientId: process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim() || '',
    m2mClientId: process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim() || '',
    m2mClientSecret: process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim() || '',
  };
}

/**
 * GET: read-only verification readback (same guard). Echoes the non-secret
 * pymthouse identifiers, runs live capability resolution for the bound account
 * (expected ["*"] for a subscription-less account), and summarizes seeded rows.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!guardOk(request)) return notFound();

  const accountId = process.env.INT_SEED_ACCOUNT_ID?.trim() || 'naap-storyboard-preview';
  const env = pymthouseEnv();

  const out: Record<string, unknown> = {
    ok: true,
    env: {
      PYMTHOUSE_ISSUER_URL: env.issuerUrl || null,
      PYMTHOUSE_PUBLIC_CLIENT_ID: env.publicClientId || null,
      PYMTHOUSE_M2M_CLIENT_ID: env.m2mClientId || null,
      PYMTHOUSE_M2M_CLIENT_SECRET_present: env.m2mClientSecret.length > 0,
      STORYBOARD_DEFAULT_DISCOVERY_ENABLED: process.env.STORYBOARD_DEFAULT_DISCOVERY_ENABLED ?? null,
      ENCRYPTION_KEY_present: (process.env.ENCRYPTION_KEY ?? '').length > 0,
    },
    accountId,
  };

  try {
    const { isPymthouseConfigured } = await import('@pymthouse/builder-sdk/config');
    out.isPymthouseConfigured = isPymthouseConfigured();
  } catch (e) {
    out.isPymthouseConfigured = `import_failed: ${e instanceof Error ? e.message : 'err'}`;
  }

  // Live capability resolution (BPP ②) — expected ["*"] for a no-subscription account.
  try {
    const { resolvePymthouseCapabilities } = await import('@/lib/billing/pymthouse-capabilities');
    const res = await resolvePymthouseCapabilities(accountId, { skipCache: true });
    out.capabilityResolution = {
      capabilities: res.capabilities,
      source: res.source,
      isWildcard: res.capabilities.length === 1 && res.capabilities[0] === '*',
    };
  } catch (e) {
    out.capabilityResolution = { error: e instanceof Error ? e.message : 'resolve_failed' };
  }

  // Per-instance adapter build check (P0): proves config + SecretVault decrypt work.
  try {
    const instance = await prisma.providerInstance.findUnique({
      where: { slug: PROVIDER_INSTANCE_SLUG },
      select: { id: true, adapterType: true, slug: true, config: true, secretRef: true, enabled: true },
    });
    if (instance) {
      const { buildAdapterForProviderInstance } = await import('@/lib/billing/provider-instance');
      const adapter = await buildAdapterForProviderInstance(instance);
      out.providerInstance = {
        id: instance.id,
        slug: instance.slug,
        adapterType: instance.adapterType,
        enabled: instance.enabled,
        secretRefSet: !!instance.secretRef,
        adapterBuilt: !!adapter,
      };
      if (adapter) {
        try {
          const v = await adapter.validate(accountId);
          out.perInstanceValidate = {
            capabilities: v.capabilities,
            isWildcard: v.capabilities.length === 1 && v.capabilities[0] === '*',
          };
        } catch (e) {
          out.perInstanceValidate = { error: e instanceof Error ? e.message : 'validate_failed' };
        }
      }
    } else {
      out.providerInstance = null;
    }
  } catch (e) {
    out.providerInstance = { error: e instanceof Error ? e.message : 'instance_read_failed' };
  }

  // Signer-mint diagnostic (BPP signer path). Capability resolution above proves
  // the builder M2M read path works; this isolates whether the per-user signer
  // token mint (upsertAppUser → mintUserAccessToken → exchange) works for this
  // app's M2M client, which is what the validate front door needs.
  try {
    const { mintSignerSessionForExternalUser } = await import('@/lib/pymthouse-client');
    const session = await mintSignerSessionForExternalUser({
      externalUserId: accountId,
      email: 'storyboard-preview@livepeer.org',
    });
    out.signerMint = {
      ok: true,
      accessTokenPresent: !!session.accessToken,
      accessTokenPrefix: (session.accessToken || '').slice(0, 6),
    };
  } catch (e) {
    out.signerMint = {
      ok: false,
      error: e instanceof Error ? e.message : 'signer_mint_failed',
    };
  }

  try {
    const team = await prisma.team.findUnique({
      where: { slug: TEAM_SLUG },
      select: { id: true, slug: true, billingAccountProviderSlug: true, billingAccountId: true },
    });
    const seatCount = team ? await prisma.seat.count({ where: { teamId: team.id } }) : 0;
    const memberCount = team ? await prisma.teamMember.count({ where: { teamId: team.id } }) : 0;
    const subscriptionCount = team ? await prisma.subscription.count({ where: { teamId: team.id } }) : 0;
    const flags = await prisma.featureFlag.findMany({
      where: { key: { in: [...TASK_FLAGS, 'sdk_connector'] } },
      select: { key: true, enabled: true },
    });
    const providerPlanCount = await prisma.providerPlan.count();
    const discoveryPlanCount = await prisma.discoveryPlan.count();
    const usageCount = await prisma.providerUsageRecord.count({
      where: { providerSlug: 'pymthouse', accountId },
    });
    const vault = await prisma.secretVault.findUnique({
      where: { key: SECRET_VAULT_KEY },
      select: { key: true },
    });
    out.db = {
      team,
      seatCount,
      memberCount,
      subscriptionCount,
      flags,
      providerPlanCount,
      discoveryPlanCount,
      providerUsageRecords: usageCount,
      secretVaultRowPresent: !!vault,
    };
  } catch (e) {
    out.db = { error: e instanceof Error ? e.message : 'db_read_failed' };
  }

  return NextResponse.json(out);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!guardOk(request)) return notFound();

  try {
    const accountId = process.env.INT_SEED_ACCOUNT_ID?.trim() || 'naap-storyboard-preview';
    const ownerEmail = process.env.INT_SEED_OWNER_EMAIL?.trim() || 'storyboard-preview@livepeer.org';
    const ownerPassword = process.env.INT_SEED_OWNER_PASSWORD?.trim();
    const env = pymthouseEnv();

    if (!env.issuerUrl || !env.publicClientId || !env.m2mClientId || !env.m2mClientSecret) {
      return NextResponse.json(
        { ok: false, error: 'missing_pymthouse_env', haveSecret: env.m2mClientSecret.length > 0 },
        { status: 400 },
      );
    }
    if (!process.env.ENCRYPTION_KEY) {
      return NextResponse.json({ ok: false, error: 'missing_ENCRYPTION_KEY' }, { status: 400 });
    }

    // 0. Self-heal additive schema on the Neon PREVIEW branch (idempotent; no-op
    //    on a fully-migrated DB). Keeps the seed robust if a migration lagged.
    const ensureSchema: string[] = [
      'ALTER TABLE "public"."Team" ADD COLUMN IF NOT EXISTS "billingAccountProviderSlug" TEXT',
      'ALTER TABLE "public"."Team" ADD COLUMN IF NOT EXISTS "billingAccountId" TEXT',
    ];
    for (const stmt of ensureSchema) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch {
        /* ignore — column/table already present or managed by migrations */
      }
    }

    // 1. Enable ONLY the task flags (DB-backed). Never touch sdk_connector here.
    for (const key of TASK_FLAGS) {
      const known = KNOWN_FLAGS.find((f) => f.key === key);
      await prisma.featureFlag.upsert({
        where: { key },
        update: { enabled: true },
        create: { key, enabled: true, description: known?.description ?? `task flag ${key}` },
      });
    }

    // 2. Owner user (loginable via email + password so the operator can mint in the UI).
    let user = await prisma.user.findUnique({ where: { email: ownerEmail } });
    const passwordHash = ownerPassword ? hashPassword(ownerPassword) : undefined;
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: ownerEmail,
          displayName: 'Storyboard Preview Admin',
          emailVerified: new Date(),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
    } else if (passwordHash) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, emailVerified: user.emailVerified ?? new Date(), lockedUntil: null },
      });
    }

    // 3. pymthouse BillingProvider (FK target for native keys; slug must equal the
    //    instance adapterType so the subscription mint route resolves it).
    const provider = await prisma.billingProvider.upsert({
      where: { slug: 'pymthouse' },
      update: { enabled: true, adapterType: 'pymthouse' },
      create: {
        slug: 'pymthouse',
        displayName: 'PymtHouse',
        description: 'PymtHouse billing provider (storyboard preview).',
        adapterType: 'pymthouse',
        authType: 'oauth',
        enabled: true,
      },
    });

    // 4. SecretVault: store the M2M secret ENCRYPTED (encryptV1, NO AAD to match
    //    getProviderInstanceSecret → decryptV1). The plaintext never leaves env.
    const encryptedSecret = encryptV1(env.m2mClientSecret);
    const existingVault = await prisma.secretVault.findUnique({ where: { key: SECRET_VAULT_KEY } });
    if (existingVault) {
      await prisma.secretVault.update({
        where: { key: SECRET_VAULT_KEY },
        data: { encryptedValue: encryptedSecret, iv: 'envelope-v1', rotatedAt: new Date() },
      });
    } else {
      await prisma.secretVault.create({
        data: {
          key: SECRET_VAULT_KEY,
          encryptedValue: encryptedSecret,
          iv: 'envelope-v1',
          description: 'pymthouse app_98575870 M2M secret (storyboard preview)',
          scope: 'global',
        },
      });
    }

    // 5. ProviderInstance for app_98575870 (P0). NON-SECRET config only; the
    //    secret is referenced via secretRef → SecretVault.
    const instance = await prisma.providerInstance.upsert({
      where: { slug: PROVIDER_INSTANCE_SLUG },
      update: {
        adapterType: 'pymthouse',
        displayName: 'PymtHouse — app_98575870',
        config: {
          issuerUrl: env.issuerUrl,
          publicClientId: env.publicClientId,
          m2mClientId: env.m2mClientId,
        },
        secretRef: SECRET_VAULT_KEY,
        enabled: true,
        status: 'active',
      },
      create: {
        slug: PROVIDER_INSTANCE_SLUG,
        adapterType: 'pymthouse',
        displayName: 'PymtHouse — app_98575870',
        config: {
          issuerUrl: env.issuerUrl,
          publicClientId: env.publicClientId,
          m2mClientId: env.m2mClientId,
        },
        secretRef: SECRET_VAULT_KEY,
        enabled: true,
        status: 'active',
        sortOrder: 0,
      },
    });

    // 6. `storyboard` Team bound to {pymthouse, accountId}. accountId stays
    //    subscription-less on pymthouse => wildcard ["*"].
    const team = await prisma.team.upsert({
      where: { slug: TEAM_SLUG },
      update: {
        ownerId: user.id,
        billingAccountProviderSlug: 'pymthouse',
        billingAccountId: accountId,
      },
      create: {
        slug: TEAM_SLUG,
        name: 'Storyboard',
        ownerId: user.id,
        billingAccountProviderSlug: 'pymthouse',
        billingAccountId: accountId,
      },
    });

    // 7. TeamMember (owner) — REQUIRED: validateTeamAccess checks membership, not
    //    Team.ownerId. Without this the owner cannot subscribe / mint via the UI.
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId: user.id } },
      update: { role: 'owner' },
      create: { teamId: team.id, userId: user.id, role: 'owner' },
    });

    // 8. Seat for the owner (admin) so the dev-manager UI can mint a key for it.
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

    // 9. A Session for the owner so headless verification can call session BFFs.
    const sessionToken = crypto.randomBytes(32).toString('hex');
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        tokenHash: hmacToken(sessionToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        versionAtCreation: user.sessionVersion ?? 0,
      },
    });

    // 10. P4 plan-spec sync IN-PROCESS (flag is ON from step 1). Pulls the
    //     instance's published plans → ProviderPlan rows + auto DiscoveryPlans so
    //     the catalog + per-app discovery populate. Graceful: never throws.
    let syncResult: unknown;
    try {
      const res = await syncAllProviderInstancePlans();
      syncResult = {
        enabled: res.enabled,
        instances: res.instances.map((i) => ({
          providerInstanceId: i.providerInstanceId,
          status: i.status,
          plansUpserted: i.plansUpserted,
          discoveryPlansUpserted: i.discoveryPlansUpserted,
        })),
      };
    } catch (e) {
      syncResult = { error: e instanceof Error ? e.message : 'sync_failed' };
    }

    return NextResponse.json({
      ok: true,
      flagsEnabled: [...TASK_FLAGS],
      sdkConnectorTouched: false,
      providerId: provider.id,
      providerInstance: { id: instance.id, slug: instance.slug, adapterType: instance.adapterType },
      secretVaultKey: SECRET_VAULT_KEY,
      team: {
        id: team.id,
        slug: team.slug,
        billingAccountProviderSlug: 'pymthouse',
        billingAccountId: accountId,
      },
      seat: { id: seat.id, role: seat.role, status: seat.status },
      owner: { id: user.id, email: ownerEmail, passwordSeeded: !!passwordHash },
      planSpecSync: syncResult,
      mintHint: {
        ui: 'Dev-manager → Developer API plugin → Apps & Subscriptions → Subscribe → Keys → Create Key',
        api: `POST /api/v1/teams/${team.id}/subscriptions  then  POST /api/v1/teams/${team.id}/subscriptions/{subId}/keys`,
        note: 'Operator subscribes + mints the naap_ key via the P3 UI. No key minted by seed.',
      },
      subscriptionCreated: false,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'seed_failed' },
      { status: 500 },
    );
  }
}

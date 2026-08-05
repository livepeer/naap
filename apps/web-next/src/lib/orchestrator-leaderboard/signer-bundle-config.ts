/**
 * Signer-bundle config loader.
 *
 * Persistence uses a sentinel LeaderboardSource row
 * (`kind = signer-bundle-config`, always disabled) so we stay inside the
 * existing plugin tables — no schema migration, no cross-plugin pollution.
 * The refresh pipeline and sources admin UI must ignore this kind.
 */

import { prisma } from '@/lib/db';
import { Prisma } from '@naap/database';
import { SIGNER_BUNDLE_DEFAULTS, listDefaultSignerBundles } from './signer-bundle-defaults';
import {
  SIGNER_BUNDLE_CONFIG_SOURCE_KIND,
  SIGNER_BUNDLE_SLUGS,
  SignerBundlesConfigSchema,
  type SignerDiscoveryBundle,
  type SignerDiscoveryBundleOverride,
  type SignerBundleSlug,
  type SignerBundlesConfig,
} from './signer-bundle-types';

function mergeBundle(
  base: SignerDiscoveryBundle,
  override?: SignerDiscoveryBundleOverride,
): SignerDiscoveryBundle {
  if (!override) return { ...base, categories: [...base.categories] };

  return {
    slug: base.slug,
    name: override.name ?? base.name,
    enabled: override.enabled ?? base.enabled,
    billingProviderSlug: override.billingProviderSlug ?? base.billingProviderSlug,
    categories: override.categories ? [...override.categories] : [...base.categories],
    categoryCapabilities: override.categoryCapabilities
      ? { ...override.categoryCapabilities }
      : base.categoryCapabilities
        ? { ...base.categoryCapabilities }
        : undefined,
    categoryStaticOrchestrators: override.categoryStaticOrchestrators
      ? { ...override.categoryStaticOrchestrators }
      : base.categoryStaticOrchestrators
        ? { ...base.categoryStaticOrchestrators }
        : undefined,
    topN: override.topN ?? base.topN,
  };
}

function parseStoredConfig(raw: unknown): SignerBundlesConfig {
  const parsed = SignerBundlesConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { bundles: [] };
  }
  return parsed.data;
}

/**
 * Optional env override: SIGNER_BUNDLE_OVERRIDES='{"bundles":[...]}'
 * Applied after DB overrides (env wins for ops hotfixes).
 */
function envOverrides(): SignerBundlesConfig {
  const raw = process.env.SIGNER_BUNDLE_OVERRIDES?.trim();
  if (!raw) return { bundles: [] };
  try {
    return parseStoredConfig(JSON.parse(raw));
  } catch {
    return { bundles: [] };
  }
}

async function readDbOverrides(): Promise<SignerBundlesConfig> {
  try {
    const row = await prisma.leaderboardSource.findUnique({
      where: { kind: SIGNER_BUNDLE_CONFIG_SOURCE_KIND },
      select: { config: true },
    });
    if (!row?.config) return { bundles: [] };
    return parseStoredConfig(row.config);
  } catch {
    return { bundles: [] };
  }
}

function applyOverrides(
  defaults: SignerDiscoveryBundle[],
  ...layers: SignerBundlesConfig[]
): SignerDiscoveryBundle[] {
  const bySlug = new Map<SignerBundleSlug, SignerDiscoveryBundle>();
  for (const d of defaults) {
    bySlug.set(d.slug, d);
  }
  for (const layer of layers) {
    for (const o of layer.bundles) {
      const base = bySlug.get(o.slug);
      if (!base) continue;
      bySlug.set(o.slug, mergeBundle(base, o));
    }
  }
  return SIGNER_BUNDLE_SLUGS.map((slug) => bySlug.get(slug)!).filter(Boolean);
}

/** Resolve all bundles: code defaults ← DB ← env. */
export async function listSignerBundles(): Promise<SignerDiscoveryBundle[]> {
  const db = await readDbOverrides();
  const env = envOverrides();
  return applyOverrides(listDefaultSignerBundles(), db, env);
}

/** Resolve one bundle by slug; null if unknown. */
export async function getSignerBundle(
  slug: SignerBundleSlug,
): Promise<SignerDiscoveryBundle | null> {
  const all = await listSignerBundles();
  return all.find((b) => b.slug === slug) ?? null;
}

/**
 * Persist admin overrides. Merges provided bundle patches into the sentinel
 * LeaderboardSource.config JSON. Always keeps the row enabled=false so the
 * refresh pipeline never treats it as a data source.
 */
export async function updateSignerBundlesConfig(
  input: SignerBundlesConfig,
): Promise<SignerDiscoveryBundle[]> {
  const parsed = SignerBundlesConfigSchema.parse(input);

  const existing = await readDbOverrides();
  const mergedBySlug = new Map<string, SignerDiscoveryBundleOverride>();
  for (const b of existing.bundles) {
    mergedBySlug.set(b.slug, b);
  }
  for (const b of parsed.bundles) {
    const prev = mergedBySlug.get(b.slug);
    mergedBySlug.set(b.slug, prev ? { ...prev, ...b } : b);
  }

  const stored: SignerBundlesConfig = {
    bundles: [...mergedBySlug.values()],
  };

  await prisma.leaderboardSource.upsert({
    where: { kind: SIGNER_BUNDLE_CONFIG_SOURCE_KIND },
    update: {
      enabled: false,
      priority: 999,
      config: stored as unknown as Prisma.InputJsonValue,
    },
    create: {
      kind: SIGNER_BUNDLE_CONFIG_SOURCE_KIND,
      enabled: false,
      priority: 999,
      config: stored as unknown as Prisma.InputJsonValue,
    },
  });

  return listSignerBundles();
}

/** True when a LeaderboardSource.kind is the config sentinel (never a refresh adapter). */
export function isSignerBundleConfigSourceKind(kind: string): boolean {
  return kind === SIGNER_BUNDLE_CONFIG_SOURCE_KIND;
}

/** Exposed for tests — merge without I/O. */
export function mergeSignerBundleForTest(
  slug: SignerBundleSlug,
  override?: SignerDiscoveryBundleOverride,
): SignerDiscoveryBundle {
  return mergeBundle(SIGNER_BUNDLE_DEFAULTS[slug], override);
}

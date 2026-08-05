/**
 * Signer-bundle discovery — types & validation.
 *
 * Two configurable python-gateway discovery endpoints return the right
 * orchestrator shortlist for:
 *   1) daydream-byoc          — Daydream signer + BYOC/tool orchs
 *   2) pymthouse-live-runner  — pymthouse signer + Live Runner orchs
 *
 * Config lives entirely inside the orchestrator-leaderboard plugin surface.
 */

import { z } from 'zod';

export const SIGNER_BUNDLE_DISCOVERY_FLAG = 'SIGNER_BUNDLE_DISCOVERY_ENABLED';

/** Sentinel LeaderboardSource.kind used to persist admin overrides (not a refresh adapter). */
export const SIGNER_BUNDLE_CONFIG_SOURCE_KIND = 'signer-bundle-config';

export const SIGNER_BUNDLE_SLUGS = ['daydream-byoc', 'pymthouse-live-runner'] as const;
export type SignerBundleSlug = (typeof SIGNER_BUNDLE_SLUGS)[number];

export const SIGNER_BUNDLE_CATEGORIES = ['scope', 'byoc', 'tool', 'lr'] as const;
export type SignerBundleCategory = (typeof SIGNER_BUNDLE_CATEGORIES)[number];

const CategoryListSchema = z.array(z.enum(SIGNER_BUNDLE_CATEGORIES)).min(1).max(4);

const CapabilityMapSchema = z
  .record(z.enum(SIGNER_BUNDLE_CATEGORIES), z.array(z.string().min(1).max(128)).max(100))
  .optional();

const StaticOrchMapSchema = z
  .record(z.enum(SIGNER_BUNDLE_CATEGORIES), z.array(z.string().url()).max(50))
  .optional();

export const SignerDiscoveryBundleSchema = z.object({
  slug: z.enum(SIGNER_BUNDLE_SLUGS),
  name: z.string().min(1).max(255),
  enabled: z.boolean(),
  billingProviderSlug: z.enum(['daydream', 'pymthouse']),
  categories: CategoryListSchema,
  categoryCapabilities: CapabilityMapSchema,
  categoryStaticOrchestrators: StaticOrchMapSchema,
  topN: z.number().int().min(1).max(1000).default(100),
});

export type SignerDiscoveryBundle = z.infer<typeof SignerDiscoveryBundleSchema>;

/** Partial admin override for one bundle (merged onto code defaults). */
export const SignerDiscoveryBundleOverrideSchema = z.object({
  slug: z.enum(SIGNER_BUNDLE_SLUGS),
  name: z.string().min(1).max(255).optional(),
  enabled: z.boolean().optional(),
  billingProviderSlug: z.enum(['daydream', 'pymthouse']).optional(),
  categories: CategoryListSchema.optional(),
  categoryCapabilities: CapabilityMapSchema,
  categoryStaticOrchestrators: StaticOrchMapSchema,
  topN: z.number().int().min(1).max(1000).optional(),
});

export type SignerDiscoveryBundleOverride = z.infer<typeof SignerDiscoveryBundleOverrideSchema>;

export const SignerBundlesConfigSchema = z.object({
  bundles: z.array(SignerDiscoveryBundleOverrideSchema).max(2),
});

export type SignerBundlesConfig = z.infer<typeof SignerBundlesConfigSchema>;

export function isSignerBundleSlug(value: string): value is SignerBundleSlug {
  return (SIGNER_BUNDLE_SLUGS as readonly string[]).includes(value);
}

/**
 * Master switch. Default OFF — any value other than "true"/"1" keeps endpoints 404.
 */
export function isSignerBundleDiscoveryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[SIGNER_BUNDLE_DISCOVERY_FLAG]?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

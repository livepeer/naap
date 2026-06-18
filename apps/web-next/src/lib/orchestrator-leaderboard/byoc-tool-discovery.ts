/**
 * NAAP-3 — BYOC + tool capability discovery.
 *
 * The NAAP-9 default plan ships HARDCODED byoc/tool capability lists (the
 * committed Daydream-parity baseline). This module provides the REAL discovery
 * source for those categories so the default plan can be driven by the live
 * fleet instead of constants — resolving the dependency inversion (NAAP-9
 * landed ahead of NAAP-3) by keeping NAAP-9 source-agnostic.
 *
 * Discovery mirrors how scope orchestrators are resolved: it reads the same
 * persisted leaderboard dataset (the distinct capabilities that have at least
 * one warm orchestrator row, via `getDatasetCapabilities`), then classifies
 * each discovered capability into `byoc` or `tool` using the plan baseline as a
 * data-driven prefix oracle. Adding a new model/tool under a known family
 * surfaces with ZERO code change; scope/unknown capabilities are excluded.
 *
 * Gated by `BYOC_TOOL_DISCOVERY_ENABLED` (env, default OFF) — consistent with
 * NAAP-9's `STORYBOARD_DEFAULT_DISCOVERY_ENABLED`. OFF → the committed baseline
 * is used unchanged (golden-set parity preserved).
 */

import { getDatasetCapabilities } from './global-dataset';
import { STORYBOARD_DEFAULT_PLAN } from './storyboard-default-plan';

/** Env flag gating discovery-driven byoc/tool capability lists (default OFF). */
export const BYOC_TOOL_DISCOVERY_FLAG = 'BYOC_TOOL_DISCOVERY_ENABLED';

/**
 * Reads the flag. Default OFF: any value other than a truthy string
 * (`"true"`/`"1"`) leaves the committed baseline authoritative.
 */
export function isByocToolDiscoveryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[BYOC_TOOL_DISCOVERY_FLAG]?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/** Injected enumeration of capabilities present in the live fleet/dataset. */
export type CapabilityCatalogSource = () => Promise<string[]>;

/** Baseline capability membership used as the category-classification oracle. */
export interface ByocToolBaseline {
  byoc: readonly string[];
  tool: readonly string[];
}

export interface ResolvedByocToolCapabilities {
  byoc: string[];
  tool: string[];
}

/** Short family prefix of a capability id (segment before the first `-`). */
function familyPrefix(capability: string): string {
  const value = capability.trim();
  const dash = value.indexOf('-');
  return dash >= 0 ? value.slice(0, dash) : value;
}

type Category = 'byoc' | 'tool';

/**
 * Build a classifier from the baseline. A discovered capability belongs to the
 * category whose known family prefixes it matches (tool checked first). Anything
 * that matches no known family (e.g. scope caps) is excluded (`null`).
 */
function buildClassifier(baseline: ByocToolBaseline): (capability: string) => Category | null {
  const toolPrefixes = new Set(baseline.tool.map(familyPrefix));
  const byocPrefixes = new Set(baseline.byoc.map(familyPrefix));
  return (capability: string): Category | null => {
    const prefix = familyPrefix(capability);
    if (toolPrefixes.has(prefix)) return 'tool';
    if (byocPrefixes.has(prefix)) return 'byoc';
    return null;
  };
}

export interface ResolveByocToolArgs {
  /** Live capability enumeration. Defaults to the leaderboard dataset. */
  discover?: CapabilityCatalogSource;
  /** Category oracle + non-disruptive fallback. Defaults to the NAAP-9 plan. */
  baseline?: ByocToolBaseline;
}

/**
 * Resolve discovery-driven byoc/tool capability lists.
 *
 * Fail-SAFE / non-disruptive: if discovery yields nothing (empty or throws) the
 * committed baseline is returned, and if discovery classifies nothing for a
 * category that category falls back to its baseline — so a discovery outage can
 * never silently empty the default plan.
 */
export async function resolveByocToolCapabilities(
  args: ResolveByocToolArgs = {},
): Promise<ResolvedByocToolCapabilities> {
  const baseline: ByocToolBaseline = args.baseline ?? {
    byoc: STORYBOARD_DEFAULT_PLAN.byoc.capabilities,
    tool: STORYBOARD_DEFAULT_PLAN.tool.capabilities,
  };
  const discover = args.discover ?? getDatasetCapabilities;

  let discovered: string[] = [];
  try {
    discovered = await discover();
  } catch {
    discovered = [];
  }

  if (!Array.isArray(discovered) || discovered.length === 0) {
    return { byoc: [...baseline.byoc], tool: [...baseline.tool] };
  }

  const classify = buildClassifier(baseline);
  const byoc: string[] = [];
  const tool: string[] = [];
  const seenByoc = new Set<string>();
  const seenTool = new Set<string>();

  for (const raw of discovered) {
    const capability = typeof raw === 'string' ? raw.trim() : '';
    if (capability === '') continue;
    const category = classify(capability);
    if (category === 'tool' && !seenTool.has(capability)) {
      seenTool.add(capability);
      tool.push(capability);
    } else if (category === 'byoc' && !seenByoc.has(capability)) {
      seenByoc.add(capability);
      byoc.push(capability);
    }
  }

  return {
    byoc: byoc.length > 0 ? byoc : [...baseline.byoc],
    tool: tool.length > 0 ? tool : [...baseline.tool],
  };
}

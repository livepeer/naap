/**
 * Service Gateway — Pricing Formatter & Cost Calculator
 *
 * Formats connector pricing for API responses and calculates
 * estimated costs with volume tier support.
 */

interface VolumeTier {
  minUnits: number;
  costPerUnit: number;
}

interface FeaturePricing {
  feature: string;
  costPerUnit: number;
  unit: string;
  description?: string;
}

interface ConnectorPricingData {
  costPerUnit: number;
  unit: string;
  currency: string;
  billingModel: string;
  freeQuota: number | null;
  volumeTiers: unknown;
  featurePricing: unknown;
  upstreamCostPerUnit: number | null;
  upstreamUnit: string | null;
  upstreamNotes: string | null;
}

export interface PricingResponse {
  connector: string;
  displayName: string;
  pricing: {
    billingModel: string;
    costPerUnit: number;
    unit: string;
    currency: string;
    freeQuota?: number;
    volumeTiers?: VolumeTier[];
    featurePricing?: FeaturePricing[];
    upstreamCost?: { costPerUnit: number; unit: string; notes?: string } | null;
  };
}

export interface CostEstimate {
  connector: string;
  requestedUnits: number;
  feature?: string;
  estimatedCost: number;
  currency: string;
  appliedTier?: VolumeTier;
  unit: string;
}

/**
 * Format a connector's pricing data for API response.
 * Returns a free pricing object when no pricing is configured.
 */
export function formatPricingResponse(
  connector: { slug: string; displayName: string },
  pricing: ConnectorPricingData | null
): PricingResponse {
  if (!pricing) {
    return {
      connector: connector.slug,
      displayName: connector.displayName,
      pricing: {
        billingModel: 'free',
        costPerUnit: 0,
        unit: 'request',
        currency: 'USD',
      },
    };
  }

  const volumeTiers = parseJsonArray<VolumeTier>(pricing.volumeTiers);
  const featurePricingList = parseJsonArray<FeaturePricing>(pricing.featurePricing);

  const upstreamCost =
    pricing.upstreamCostPerUnit != null
      ? {
          costPerUnit: pricing.upstreamCostPerUnit,
          unit: pricing.upstreamUnit || pricing.unit,
          ...(pricing.upstreamNotes ? { notes: pricing.upstreamNotes } : {}),
        }
      : null;

  return {
    connector: connector.slug,
    displayName: connector.displayName,
    pricing: {
      billingModel: pricing.billingModel,
      costPerUnit: pricing.costPerUnit,
      unit: pricing.unit,
      currency: pricing.currency,
      ...(pricing.freeQuota != null ? { freeQuota: pricing.freeQuota } : {}),
      ...(volumeTiers.length > 0 ? { volumeTiers } : {}),
      ...(featurePricingList.length > 0 ? { featurePricing: featurePricingList } : {}),
      ...(upstreamCost ? { upstreamCost } : {}),
    },
  };
}

/**
 * Calculate estimated cost for a given number of units,
 * applying volume tiers and feature-specific pricing.
 */
export function calculateCost(
  pricing: ConnectorPricingData,
  units: number,
  feature?: string,
  connectorSlug = ''
): CostEstimate {
  const featurePricingList = parseJsonArray<FeaturePricing>(pricing.featurePricing);
  const volumeTiers = parseJsonArray<VolumeTier>(pricing.volumeTiers);

  let costPerUnit = pricing.costPerUnit;
  let unit = pricing.unit;
  let appliedTier: VolumeTier | undefined;
  let usedFeaturePricing = false;

  // Feature-specific pricing takes precedence over base and volume tiers
  if (feature) {
    const fp = featurePricingList.find((f) => f.feature === feature);
    if (fp) {
      costPerUnit = fp.costPerUnit;
      unit = fp.unit;
      usedFeaturePricing = true;
    }
  }

  // Volume tiers only apply when feature pricing was NOT used
  if (!usedFeaturePricing) {
    const sortedTiers = [...volumeTiers].sort((a, b) => b.minUnits - a.minUnits);
    for (const tier of sortedTiers) {
      if (units >= tier.minUnits) {
        costPerUnit = tier.costPerUnit;
        appliedTier = tier;
        break;
      }
    }
  }

  const estimatedCost = Math.round(costPerUnit * units * 100) / 100;

  return {
    connector: connectorSlug,
    requestedUnits: units,
    ...(feature ? { feature } : {}),
    estimatedCost,
    currency: pricing.currency,
    ...(appliedTier ? { appliedTier } : {}),
    unit,
  };
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

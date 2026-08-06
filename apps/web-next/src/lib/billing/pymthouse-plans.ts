/**
 * Map pymthouse `listBillingProducts` rows onto the BPP ④ {@link Plan} shape.
 * Pure helpers — no I/O — so the adapter + unit tests share one mapper.
 */

import { normalizeProviderCapabilities } from '@/lib/capabilities/taxonomy';

import type { Plan } from './adapter';

/** Subset of SDK `BillingProduct` the mapper needs (avoids a hard type import). */
export interface PymthouseBillingProductLike {
  id: string;
  name?: string | null;
  type?: string | null;
  status?: string | null;
  priceAmount?: string | null;
  priceCurrency?: string | null;
  allowance?: { billingCycle?: string | null } | null;
  capabilities?: ReadonlyArray<{
    pipeline?: string | null;
    modelId?: string | null;
  }> | null;
}

function mapInterval(
  product: PymthouseBillingProductLike,
): 'month' | 'year' | 'once' | null {
  const type = (product.type ?? '').trim().toLowerCase();
  if (type === 'one_time' || type === 'once' || type === 'credit') {
    return 'once';
  }
  const cycle = (product.allowance?.billingCycle ?? '').trim().toLowerCase();
  if (cycle === 'yearly' || cycle === 'annual' || cycle === 'year') return 'year';
  if (cycle === 'monthly' || cycle === 'month' || cycle === 'weekly' || cycle === 'daily') {
    // BPP only allows month|year|once; weekly/daily coerce to month.
    return 'month';
  }
  if (type === 'subscription') return 'month';
  return null;
}

function mapPrice(product: PymthouseBillingProductLike): Plan['price'] | undefined {
  const interval = mapInterval(product);
  if (!interval) return undefined;
  const raw = product.priceAmount?.trim() ?? '';
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const currencyRaw = (product.priceCurrency ?? 'USD').trim().toUpperCase();
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : 'USD';
  return { amount, interval, currency };
}

function mapBundles(product: PymthouseBillingProductLike): Plan['bundles'] {
  const raw: string[] = [];
  for (const cap of product.capabilities ?? []) {
    const pipeline = cap.pipeline?.trim();
    const modelId = cap.modelId?.trim();
    if (pipeline && modelId) raw.push(`${pipeline}:${modelId}`);
  }
  return normalizeProviderCapabilities(raw).map((capability) => ({ capability }));
}

/** Map one pymthouse product to a BPP Plan. Returns null when id is blank. */
export function mapBillingProductToPlan(product: PymthouseBillingProductLike): Plan | null {
  const id = typeof product.id === 'string' ? product.id.trim() : '';
  if (!id) return null;
  const name = typeof product.name === 'string' ? product.name.trim() : '';
  const price = mapPrice(product);
  return {
    id,
    ...(name ? { name } : {}),
    ...(price ? { price } : {}),
    bundles: mapBundles(product),
  };
}

/**
 * Map a product list to BPP plans. Skips blank ids. By default only `active`
 * products are included (checkout rejects non-active targets).
 */
export function mapBillingProductsToPlans(
  products: ReadonlyArray<PymthouseBillingProductLike>,
  opts?: { includeInactive?: boolean },
): Plan[] {
  const out: Plan[] = [];
  for (const product of products) {
    if (!opts?.includeInactive) {
      const status = (product.status ?? '').trim().toLowerCase();
      if (status && status !== 'active') continue;
    }
    const plan = mapBillingProductToPlan(product);
    if (plan) out.push(plan);
  }
  return out;
}

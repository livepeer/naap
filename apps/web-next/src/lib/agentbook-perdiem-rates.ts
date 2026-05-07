/**
 * Per-diem rate lookup. Pure helper — no DB, no network.
 *
 * Source: GSA (General Services Administration) per-diem rates for
 * federal travel within CONUS — same table the IRS allows freelancers
 * and small businesses to use in lieu of itemising every meal. We
 * bundle the top ~30 high-cost destinations Maya is likely to travel
 * to; everything else falls back to the CONUS standard rate ($59
 * M&IE / $107 lodging) which is what the IRS publishes for any
 * locality not on the high-cost list.
 *
 * Two values per row:
 *   • `mieCents`     — daily Meals & Incidental Expenses allowance.
 *   • `lodgingCents` — daily lodging allowance (only used when the
 *                      caller opts in via the "+ lodging" path).
 *
 * Rates here are FY 2025 published values (effective Oct 1 2024 –
 * Sep 30 2025). Refreshing this table is part of the annual
 * tax-table maintenance pass — the same one that touches the
 * mileage rates above.
 */

import 'server-only';

export interface PerDiemRate {
  /** Display label, e.g. "New York City". */
  city: string;
  /** Two-letter state code, "NY" / "CA" / "DC" / etc. */
  state: string;
  /** Daily Meals & Incidental Expenses allowance, in cents. */
  mieCents: number;
  /** Daily lodging allowance, in cents. */
  lodgingCents: number;
}

/**
 * CONUS (Continental US) standard per-diem — what the IRS allows for
 * any locality not on the high-cost list. $59 M&IE + $107 lodging.
 */
export const CONUS_DEFAULT_MIE_CENTS = 5_900;
export const CONUS_DEFAULT_LODGING_CENTS = 10_700;

/**
 * Bundled GSA high-cost-locality table. Keys are lowercased canonical
 * city names; aliases map alternate phrasings (NYC, DC, LA, …) to the
 * canonical entry.
 */
const TABLE: Record<string, PerDiemRate> = {
  'new york city': {
    city: 'New York City',
    state: 'NY',
    mieCents: 7_900,
    lodgingCents: 28_400,
  },
  'san francisco': {
    city: 'San Francisco',
    state: 'CA',
    mieCents: 7_900,
    lodgingCents: 27_000,
  },
  'los angeles': {
    city: 'Los Angeles',
    state: 'CA',
    mieCents: 7_400,
    lodgingCents: 18_100,
  },
  'san diego': {
    city: 'San Diego',
    state: 'CA',
    mieCents: 7_400,
    lodgingCents: 19_400,
  },
  'oakland': {
    city: 'Oakland',
    state: 'CA',
    mieCents: 7_400,
    lodgingCents: 19_900,
  },
  'san jose': {
    city: 'San Jose',
    state: 'CA',
    mieCents: 7_400,
    lodgingCents: 21_900,
  },
  'chicago': {
    city: 'Chicago',
    state: 'IL',
    mieCents: 7_900,
    lodgingCents: 18_700,
  },
  'boston': {
    city: 'Boston',
    state: 'MA',
    mieCents: 7_900,
    lodgingCents: 27_400,
  },
  'washington dc': {
    city: 'Washington DC',
    state: 'DC',
    mieCents: 7_900,
    lodgingCents: 25_700,
  },
  'seattle': {
    city: 'Seattle',
    state: 'WA',
    mieCents: 7_900,
    lodgingCents: 21_500,
  },
  'austin': {
    city: 'Austin',
    state: 'TX',
    mieCents: 6_900,
    lodgingCents: 17_500,
  },
  'dallas': {
    city: 'Dallas',
    state: 'TX',
    mieCents: 6_900,
    lodgingCents: 14_900,
  },
  'houston': {
    city: 'Houston',
    state: 'TX',
    mieCents: 6_900,
    lodgingCents: 14_300,
  },
  'denver': {
    city: 'Denver',
    state: 'CO',
    mieCents: 7_400,
    lodgingCents: 19_900,
  },
  'miami': {
    city: 'Miami',
    state: 'FL',
    mieCents: 7_400,
    lodgingCents: 21_700,
  },
  'orlando': {
    city: 'Orlando',
    state: 'FL',
    mieCents: 6_400,
    lodgingCents: 14_300,
  },
  'atlanta': {
    city: 'Atlanta',
    state: 'GA',
    mieCents: 6_900,
    lodgingCents: 16_500,
  },
  'philadelphia': {
    city: 'Philadelphia',
    state: 'PA',
    mieCents: 7_400,
    lodgingCents: 19_500,
  },
  'pittsburgh': {
    city: 'Pittsburgh',
    state: 'PA',
    mieCents: 6_400,
    lodgingCents: 14_400,
  },
  'minneapolis': {
    city: 'Minneapolis',
    state: 'MN',
    mieCents: 7_400,
    lodgingCents: 16_500,
  },
  'detroit': {
    city: 'Detroit',
    state: 'MI',
    mieCents: 6_900,
    lodgingCents: 14_500,
  },
  'baltimore': {
    city: 'Baltimore',
    state: 'MD',
    mieCents: 7_400,
    lodgingCents: 18_500,
  },
  'phoenix': {
    city: 'Phoenix',
    state: 'AZ',
    mieCents: 6_900,
    lodgingCents: 17_400,
  },
  'portland': {
    city: 'Portland',
    state: 'OR',
    mieCents: 7_400,
    lodgingCents: 17_900,
  },
  'nashville': {
    city: 'Nashville',
    state: 'TN',
    mieCents: 7_400,
    lodgingCents: 19_700,
  },
  'new orleans': {
    city: 'New Orleans',
    state: 'LA',
    mieCents: 7_400,
    lodgingCents: 19_300,
  },
  'las vegas': {
    city: 'Las Vegas',
    state: 'NV',
    mieCents: 7_400,
    lodgingCents: 16_900,
  },
  'salt lake city': {
    city: 'Salt Lake City',
    state: 'UT',
    mieCents: 6_900,
    lodgingCents: 15_300,
  },
  'honolulu': {
    city: 'Honolulu',
    state: 'HI',
    mieCents: 7_900,
    lodgingCents: 24_900,
  },
  'anchorage': {
    city: 'Anchorage',
    state: 'AK',
    mieCents: 7_900,
    lodgingCents: 19_500,
  },
};

const ALIASES: Record<string, string> = {
  'nyc': 'new york city',
  'new york': 'new york city',
  'ny': 'new york city',
  'manhattan': 'new york city',
  'sf': 'san francisco',
  'san fran': 'san francisco',
  'la': 'los angeles',
  'l.a.': 'los angeles',
  'dc': 'washington dc',
  'd.c.': 'washington dc',
  'washington': 'washington dc',
  'washington d.c.': 'washington dc',
  'sd': 'san diego',
  'sj': 'san jose',
  'philly': 'philadelphia',
};

/**
 * Resolve a free-form city hint to a PerDiemRate. Returns the CONUS
 * standard fallback (never `null`) when no match is found — callers
 * can detect the fallback by comparing `mieCents` to
 * `CONUS_DEFAULT_MIE_CENTS`.
 *
 * Despite the type signature `| null` (kept for forward-compat with
 * a future "strict mode"), the current implementation always returns
 * a row so the bot UX never has to special-case "we couldn't find
 * your city".
 */
export function lookupPerDiem(city: string): PerDiemRate | null {
  const norm = (city || '').trim().toLowerCase();
  if (!norm) {
    return {
      city: 'CONUS Standard',
      state: 'US',
      mieCents: CONUS_DEFAULT_MIE_CENTS,
      lodgingCents: CONUS_DEFAULT_LODGING_CENTS,
    };
  }

  // Direct hit
  if (TABLE[norm]) return TABLE[norm];
  // Alias hit
  const aliased = ALIASES[norm];
  if (aliased && TABLE[aliased]) return TABLE[aliased];

  // Loose-contains match: "Austin TX" / "Austin, TX" / "Austin Texas"
  // all should land on Austin. Walk the canonical-key list and pick
  // the longest match (so "san francisco" beats "san" if we ever add
  // a "San" entry). Aliases are searched too — "philly bar crawl"
  // should match philly → philadelphia.
  let best: PerDiemRate | null = null;
  let bestLen = 0;
  for (const key of Object.keys(TABLE)) {
    if (norm.includes(key) && key.length > bestLen) {
      best = TABLE[key];
      bestLen = key.length;
    }
  }
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    // Word-boundary check on the alias so "lap" doesn't match "la".
    const re = new RegExp(`\\b${alias.replace(/\./g, '\\.')}\\b`, 'i');
    if (re.test(norm) && alias.length > bestLen && TABLE[canonical]) {
      best = TABLE[canonical];
      bestLen = alias.length;
    }
  }
  if (best) return best;

  // Unknown city — fall back to CONUS standard.
  return {
    city: 'CONUS Standard',
    state: 'US',
    mieCents: CONUS_DEFAULT_MIE_CENTS,
    lodgingCents: CONUS_DEFAULT_LODGING_CENTS,
  };
}

export const BILLING_PROVIDERS = [
  {
    slug: 'daydream',
    displayName: 'Daydream',
    description: 'Real-time AI video generation',
    icon: 'Cloud',
    authType: 'oauth',
    enabled: true,
    sortOrder: 0,
    // `adapterType` selects the BillingProviderAdapter (NAAP-A-db). Daydream is
    // the legacy direct path, not a BPP adapter, so it has none.
    adapterType: null as string | null,
  },
  {
    slug: 'pymthouse',
    displayName: 'PymtHouse',
    description: 'Billing, plans, and Livepeer AI access via PymtHouse',
    icon: 'Wallet',
    authType: 'oauth',
    enabled: true,
    sortOrder: 1,
    adapterType: 'pymthouse' as string | null,
  },
  {
    // STUB-deploy: the C0 in-memory stub provider, registered as a first-class
    // BillingProvider alongside pymthouse. It is the SECOND BPP implementation
    // and proves the seam is provider-agnostic (INT-G / E8). `enabled:false`
    // keeps it out of the production provider picker by default; a team can
    // still bind its `billingAccountRef.providerSlug` to "stub" and the front
    // door resolves it through the StubAdapter. Never carries real billing.
    slug: 'stub',
    displayName: 'Stub Provider (integration)',
    description: 'In-memory C0 stub billing provider — proves the provider-agnostic seam (INT-G). Not for production billing.',
    icon: 'Beaker',
    authType: 'none',
    enabled: false,
    sortOrder: 99,
    adapterType: 'stub' as string | null,
  },
] as const;

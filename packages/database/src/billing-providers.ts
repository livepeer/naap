export const BILLING_PROVIDERS = [
  {
    slug: 'daydream',
    displayName: 'Daydream',
    description: 'Real-time AI video generation',
    icon: 'Cloud',
    authType: 'oauth',
    enabled: true,
    sortOrder: 0,
  },
  {
    slug: 'pymthouse',
    displayName: 'PymtHouse',
    description: 'Billing, plans, and Livepeer AI access via PymtHouse',
    icon: 'Wallet',
    authType: 'oauth',
    enabled: true,
    sortOrder: 1,
  },
] as const;

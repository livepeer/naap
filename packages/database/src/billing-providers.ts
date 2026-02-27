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
    displayName: 'pymthouse',
    description: 'Livepeer payment clearinghouse via pymthouse',
    icon: 'Wallet',
    authType: 'oauth',
    enabled: true,
    sortOrder: 10,
  },
] as const;

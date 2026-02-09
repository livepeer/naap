/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React 19 features
  reactStrictMode: true,

  // Experimental features for better performance
  experimental: {
    // Enable React Server Components optimizations
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },

  // Include Prisma engine binaries in the standalone output.
  // Required because the Prisma client is generated in a monorepo workspace
  // package (packages/database/src/generated/client/) which Next.js standalone
  // tracing doesn't automatically include.
  outputFileTracingIncludes: {
    '/api/**': ['../../packages/database/src/generated/client/**'],
    '/dashboard/**': ['../../packages/database/src/generated/client/**'],
    '/plugins/**': ['../../packages/database/src/generated/client/**'],
  },

  // Transpile monorepo packages
  // Note: @naap/database is excluded — Prisma generates JS output via postinstall,
  // and adding it here causes type-portability errors with Prisma runtime internals.
  transpilePackages: [
    '@naap/ui',
    '@naap/types',
    '@naap/theme',
    '@naap/utils',
    '@naap/config',
    '@naap/plugin-sdk',
  ],

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.vercel-storage.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
    ],
  },

  // Webpack configuration for monorepo
  webpack: (config, { isServer }) => {
    // Handle node modules in server components
    if (isServer) {
      config.externals = config.externals || [];
    }

    // Reduce file watcher scope to prevent EMFILE errors in large monorepos.
    // Without this, Watchpack tries to watch all node_modules directories
    // across every package/plugin, exhausting macOS file descriptor limits.
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
      ],
    };

    return config;
  },

  // Environment variables that should be available on client
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },

  // Headers for security and CORS
  async headers() {
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'http://localhost:3000', // Legacy shell
      'https://naap.dev',
      'https://*.vercel.app',
    ].filter(Boolean);

    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowedOrigins[0] },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS,PATCH' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
      {
        // Security headers for all pages
        // NOTE: Permissions-Policy must allow camera/microphone globally because
        // plugins load via client-side navigation (SPA). The Permissions-Policy
        // header is only applied on the initial document load -- if the user
        // first loads /dashboard (with camera=()), then navigates client-side
        // to /daydream, the document retains camera=() and blocks getUserMedia.
        // Allowing (self) globally is safe: it only permits same-origin access,
        // and the browser still prompts the user for explicit consent.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()' },
        ],
      },
    ];
  },

  // Rewrites for proxying
  async rewrites() {
    const rewrites = [];

    // In development, proxy API calls to legacy backend
    if (process.env.NODE_ENV === 'development' && process.env.LEGACY_API_PROXY === 'true') {
      const baseSvcUrl = process.env.BASE_SVC_URL || 'http://localhost:4000';
      rewrites.push({
        source: '/api/legacy/:path*',
        destination: `${baseSvcUrl}/api/:path*`,
      });
    }

    return rewrites;
  },

  // Skip type checking during build — CI runs typecheck separately (ci.yml lint-typecheck job).
  // This prevents pre-existing type errors from blocking Vercel deployments.
  typescript: {
    ignoreBuildErrors: true,
  },

  // Skip ESLint during build — CI runs lint separately (ci.yml lint-typecheck job).
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Output configuration for Vercel
  output: 'standalone',

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

module.exports = nextConfig;

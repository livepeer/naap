const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React 19 features
  reactStrictMode: true,

  // Experimental features for better performance
  experimental: {
    // Enable React Server Components optimizations
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },

  // Externalize heavy server-side packages so they're resolved from
  // node_modules at runtime instead of being bundled into every function.
  // Critical for the agentbook-* catch-all routes which were each bundling
  // a full Prisma engine, pushing past Vercel's 262 MB function-size cap.
  serverExternalPackages: [
    '@naap/database',
    '@prisma/client',
    '@prisma/engines',
    'express',
    'grammy',
    '@naap/plugin-server-sdk',
    '@naap/plugin-agentbook-tax-backend',
    '@naap/plugin-agentbook-invoice-backend',
    '@naap/plugin-agentbook-core-backend',
    '@naap/plugin-agentbook-expense-backend',
  ],

  // Monorepo: set tracing root to the repo root so Next.js can find
  // files from workspace packages (e.g. @naap/database engine binaries).
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // Plugin Express backends are externalized via serverExternalPackages, so
  // Next.js does not trace their files automatically. Force their pre-built
  // dist/ output + plugin.json + transitive runtime deps into each function
  // bundle so the runtime dynamic import (and the readFileSync of plugin.json)
  // can resolve. outputFileTracingIncludes does NOT recurse through externalized
  // packages, so we must enumerate transitive deps explicitly.
  outputFileTracingIncludes: (() => {
    // Deps that every plugin Express server pulls in (dotenv, plugin-server-sdk
    // + its express/cors/helmet/compression middleware stack). Hoisted to root
    // node_modules by npm workspaces.
    const sharedPluginBackendDeps = [
      '../../packages/plugin-server-sdk/dist/**',
      '../../packages/plugin-server-sdk/package.json',
      '../../node_modules/dotenv/**',
      '../../node_modules/cors/**',
      '../../node_modules/helmet/**',
      '../../node_modules/compression/**',
      '../../node_modules/accepts/**',
      '../../node_modules/bytes/**',
      '../../node_modules/on-headers/**',
      '../../node_modules/safe-buffer/**',
      '../../node_modules/vary/**',
      '../../node_modules/object-assign/**',
    ];
    return {
      '/api/v1/agentbook-tax/**': [
        '../../plugins/agentbook-tax/plugin.json',
        '../../plugins/agentbook-tax/backend/dist/**',
        '../../plugins/agentbook-tax/backend/package.json',
        ...sharedPluginBackendDeps,
      ],
      '/api/v1/agentbook-invoice/**': [
        '../../plugins/agentbook-invoice/plugin.json',
        '../../plugins/agentbook-invoice/backend/dist/**',
        '../../plugins/agentbook-invoice/backend/package.json',
        ...sharedPluginBackendDeps,
      ],
      '/api/v1/agentbook-core/**': [
        '../../plugins/agentbook-core/plugin.json',
        '../../plugins/agentbook-core/backend/dist/**',
        '../../plugins/agentbook-core/backend/package.json',
        ...sharedPluginBackendDeps,
      ],
      '/api/v1/agentbook-expense/**': [
        '../../plugins/agentbook-expense/plugin.json',
        '../../plugins/agentbook-expense/backend/dist/**',
        '../../plugins/agentbook-expense/backend/package.json',
        ...sharedPluginBackendDeps,
        // expense-specific: plaid SDK + its axios HTTP client.
        '../../node_modules/plaid/dist/**',
        '../../node_modules/plaid/package.json',
        '../../node_modules/axios/dist/**',
        '../../node_modules/axios/lib/**',
        '../../node_modules/axios/index.js',
        '../../node_modules/axios/package.json',
        '../../node_modules/follow-redirects/**',
        '../../node_modules/form-data/lib/**',
        '../../node_modules/form-data/package.json',
        '../../node_modules/asynckit/**',
        '../../node_modules/combined-stream/**',
        '../../node_modules/delayed-stream/**',
        '../../node_modules/proxy-from-env/**',
        '../../node_modules/mime-types/**',
        '../../node_modules/mime-db/**',
      ],
    };
  })(),

  // Each plugin catch-all route imports a single plugin's Express app.
  // Without these excludes, every Vercel function bundles all four plugin
  // backends + their node_modules — pushing past Vercel's 262 MB limit.
  // Trim each function to only its own plugin sources.
  outputFileTracingExcludes: {
    '/api/v1/agentbook-tax/**': [
      '../../plugins/agentbook-invoice/**',
      '../../plugins/agentbook-core/**',
      '../../plugins/agentbook-expense/**',
    ],
    '/api/v1/agentbook-invoice/**': [
      '../../plugins/agentbook-tax/**',
      '../../plugins/agentbook-core/**',
      '../../plugins/agentbook-expense/**',
    ],
    '/api/v1/agentbook-core/**': [
      '../../plugins/agentbook-tax/**',
      '../../plugins/agentbook-invoice/**',
      '../../plugins/agentbook-expense/**',
    ],
    '/api/v1/agentbook-expense/**': [
      '../../plugins/agentbook-tax/**',
      '../../plugins/agentbook-invoice/**',
      '../../plugins/agentbook-core/**',
    ],
    // Other API routes don't need any plugin backend bundled.
    '/api/**': [
      '../../plugins/*/backend/node_modules/**',
      '../../plugins/*/backend/src/**',
      '../../plugins/*/frontend/**',
      // Darwin Prisma binaries: Vercel runs Linux only.
      '../../packages/database/src/generated/client/libquery_engine-darwin-*.node',
      '../../packages/database/src/generated/client/libquery_engine-windows-*.node',
    ],
    // Pages don't need any plugin backend at all.
    // Explicitly target src/ + node_modules/ rather than backend/** so that
    // each agentbook-* route can still pull in its own backend/dist/** via
    // outputFileTracingIncludes (the broad backend/** pattern was winning
    // over the per-route include and stripping the externalized backends).
    '/**': [
      '../../plugins/*/backend/node_modules/**',
      '../../plugins/*/backend/src/**',
      '../../plugins/*/frontend/**',
      // Darwin Prisma binaries: Vercel runs Linux only.
      '../../packages/database/src/generated/client/libquery_engine-darwin-*.node',
      '../../packages/database/src/generated/client/libquery_engine-windows-*.node',
    ],
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
    '@naap/cache',
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
    // Prisma engines are resolved from packages/database/src/generated/client/
    // at runtime via @prisma/client + @prisma/engines (serverExternalPackages).
    // The PrismaPlugin webpack helper used to copy engines into .next/server/chunks/
    // but it duplicated each engine 4-5 times (one copy per webpack chunk that
    // referenced Prisma), pushing every function bundle past Vercel's 262 MB cap.
    // outputFileTracingIncludes (next.config below) ensures engines ship via
    // file tracing — once per platform, deduped — without webpack chunking.

    // Transpiled workspace packages use TypeScript's .js extension convention
    // (e.g. `from './utils/index.js'` in .ts files). Webpack needs extensionAlias
    // to resolve these to the actual .ts/.tsx source files.
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };

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

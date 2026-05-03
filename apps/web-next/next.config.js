const path = require('path');
const { PrismaPlugin } = require('@prisma/nextjs-monorepo-workaround-plugin');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },

  // Monorepo: tracing root is the repo root so Next.js can find files
  // from workspace packages (e.g. @naap/database engine binaries).
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // Strip the macOS/Windows Prisma engines so Linux-only Vercel functions
  // don't ship them.
  outputFileTracingExcludes: {
    '**': [
      '../../packages/database/src/generated/client/libquery_engine-darwin-*.node',
      '../../packages/database/src/generated/client/libquery_engine-windows-*.node',
    ],
  },

  // Transpile monorepo packages with TS sources.
  transpilePackages: [
    '@naap/ui',
    '@naap/types',
    '@naap/theme',
    '@naap/utils',
    '@naap/config',
    '@naap/plugin-sdk',
    '@naap/cache',
  ],

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.vercel-storage.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },

  webpack: (config, { isServer }) => {
    // Prisma + Next.js monorepo: copy engine binaries into the standalone
    // bundle. Official fix for Prisma deployments on Vercel from a monorepo.
    if (isServer && process.env.NODE_ENV === 'production') {
      config.plugins = [...config.plugins, new PrismaPlugin()];
    }

    // Workspace packages use the `.js` extension convention in TS source
    // (`from './foo.js'`). Webpack needs this alias to resolve to .ts/.tsx.
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };

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

  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },

  async headers() {
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'http://localhost:3000',
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
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()' },
        ],
      },
    ];
  },

  async rewrites() {
    const rewrites = [];
    if (process.env.NODE_ENV === 'development' && process.env.LEGACY_API_PROXY === 'true') {
      const baseSvcUrl = process.env.BASE_SVC_URL || 'http://localhost:4000';
      rewrites.push({
        source: '/api/legacy/:path*',
        destination: `${baseSvcUrl}/api/:path*`,
      });
    }
    return rewrites;
  },

  // Skip type checking during build — CI runs typecheck separately.
  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  output: 'standalone',

  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

module.exports = nextConfig;

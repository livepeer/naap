const path = require('path');
const fs = require('fs');
const { PrismaPlugin } = require('@prisma/nextjs-monorepo-workaround-plugin');

// ─── Plugin Auto-Discovery ─────────────────────────────────────────────────
// Scan plugins/*/plugin.json at config-load time and generate URL rewrites.
// This eliminates hardcoded route maps in middleware.ts — new plugins are
// picked up automatically when the dev server starts or the app is built.
// ────────────────────────────────────────────────────────────────────────────

function toCamelCase(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Discover plugin routes from plugins/\*\/plugin.json AND examples/\*\/plugin.json
 * and generate Next.js beforeFiles rewrites:
 *   /gateway      → /plugins/serviceGateway
 *   /leaderboard  → /plugins/leaderboard
 */
function discoverPluginRewrites() {
  const scanDirs = [
    path.resolve(__dirname, '../../plugins'),
  ];

  const rewrites = [];

  for (const baseDir of scanDirs) {
    if (!fs.existsSync(baseDir)) continue;

    for (const dir of fs.readdirSync(baseDir)) {
      if (dir.startsWith('__') || dir.startsWith('.')) continue;
      const manifestPath = path.join(baseDir, dir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const routes = manifest.frontend?.routes || [];
        const camelName = toCamelCase(dir);

        for (const route of routes) {
          if (route.endsWith('/*')) {
            const prefix = route.slice(0, -2);
            rewrites.push({
              source: `${prefix}/:path*`,
              destination: `/plugins/${camelName}`,
            });
          } else {
            rewrites.push({ source: route, destination: `/plugins/${camelName}` });
          }
        }
      } catch (e) {
        console.warn(`[next.config] Failed to read ${manifestPath}:`, e.message);
      }
    }
  }

  if (rewrites.length > 0) {
    console.log(
      `[next.config] Auto-discovered ${rewrites.length} plugin rewrites from ${
        new Set(rewrites.map((r) => r.destination)).size
      } plugins`,
    );
  }
  return rewrites;
}

const pluginRewrites = discoverPluginRewrites();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React 19 features
  reactStrictMode: true,

  // Experimental features for better performance
  experimental: {
    // Enable React Server Components optimizations
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },

  // Monorepo: set tracing root to the repo root so Next.js can find
  // files from workspace packages (e.g. @naap/database engine binaries).
  outputFileTracingRoot: path.join(__dirname, '../../'),

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
    // Prisma: ensure engine binaries are included in the standalone bundle.
    // This is the official fix for Prisma + Next.js monorepo deployments.
    // Important: in `next dev`, the server output directories may not exist
    // when the plugin runs, which can cause copyfile ENOENT errors.
    // We only need this plugin for production (standalone) builds.
    if (isServer && process.env.NODE_ENV === 'production') {
      config.plugins = [...config.plugins, new PrismaPlugin()];
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

  // Rewrites: plugin routes (auto-discovered) + dev proxy
  async rewrites() {
    const devRewrites = [];

    // In development, proxy API calls to legacy backend
    if (process.env.NODE_ENV === 'development' && process.env.LEGACY_API_PROXY === 'true') {
      const baseSvcUrl = process.env.BASE_SVC_URL || 'http://localhost:4000';
      devRewrites.push({
        source: '/api/legacy/:path*',
        destination: `${baseSvcUrl}/api/:path*`,
      });
    }

    return {
      // beforeFiles: rewrites checked AFTER middleware but BEFORE filesystem.
      // Plugin routes (e.g. /gateway) don't have matching page files, so
      // these rewrites transparently map them to /plugins/{camelCaseName}.
      beforeFiles: pluginRewrites,
      afterFiles: devRewrites,
    };
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

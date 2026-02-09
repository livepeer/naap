# Plugin Serverless Architecture Migration

This document describes the migration from Module Federation-based plugins to a serverless UMD bundle architecture for Vercel deployment.

## Overview

The NAAP platform has migrated its plugin system from Vite Module Federation to UMD bundles deployed via Vercel Blob storage. This enables:

- **Serverless deployment** - No persistent plugin server required
- **CDN delivery** - Fast global distribution with caching
- **Better DX** - Simpler build process using esbuild
- **Production ready** - Robust error handling, security, and monitoring

## Architecture

### Before (Module Federation)
```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Shell Web  │────▶│   Plugin Server  │────▶│  Plugin Bundles │
│  (Next.js)  │     │   (Express)      │     │  (remoteEntry)  │
└─────────────┘     └──────────────────┘     └─────────────────┘
```

### After (Serverless UMD)
```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Shell Web  │────▶│   Vercel Blob    │────▶│   UMD Bundles   │
│  (Next.js)  │     │   (CDN)          │     │   (*.js)        │
└─────────────┘     └──────────────────┘     └─────────────────┘
        │                                             │
        ▼                                             ▼
┌─────────────┐                             ┌─────────────────┐
│  IndexedDB  │◀────────────────────────────│   Cached Copy   │
│   Cache     │                             │                 │
└─────────────┘                             └─────────────────┘
```

## Key Components

### 1. Plugin SDK (`packages/plugin-sdk`)

The SDK provides:
- `createUMDPluginMount` - Factory for creating mountable plugin modules
- `ShellContext` interface - Type-safe shell integration
- UMD build output at `dist/umd/naap-plugin-sdk.js`

### 2. Plugin Build System (`packages/plugin-build`)

The build system provides:
- `buildPlugin` - Builds a single plugin to UMD format
- `buildAllPlugins` - Builds all plugins in batch
- `validatePluginBundle` - Validates bundle structure
- CLI tool: `npx naap-plugin-build build plugins/my-plugin`

### 3. Plugin Storage (`apps/web-next/src/lib/plugins/storage.ts`)

Manages plugin assets in Vercel Blob:
- `uploadPlugin` - Uploads bundle and styles to Blob
- `deleteVersion` - Removes old versions
- `listVersions` - Lists available versions
- CDN URL generation

### 4. UMD Loader (`apps/web-next/src/lib/plugins/umd-loader.ts`)

Loads UMD bundles at runtime:
- Script tag injection
- Global name resolution
- Retry logic with exponential backoff
- Module caching

### 5. IndexedDB Cache (`apps/web-next/src/lib/plugins/cache.ts`)

Client-side caching:
- Stores bundle content in IndexedDB
- TTL-based expiration (default: 7 days)
- Hash validation for cache busting
- 50MB cache limit with LRU eviction

### 6. Plugin Sandbox (`apps/web-next/src/lib/plugins/sandbox.ts`)

Security restrictions:
- Token access control
- Navigation restrictions
- Event bus scoping
- Logger prefixing

### 7. CSP Headers (`apps/web-next/src/lib/plugins/csp.ts`)

Content Security Policy:
- Generates per-plugin CSP
- Allowed CDN hosts whitelist
- Development mode relaxations

## Migration Guide

### For Plugin Developers

1. **Update your plugin's main entry:**

```typescript
// src/App.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { ShellContext } from '@naap/types';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MyPage } from './pages/MyPage';

let shellContext: ShellContext | null = null;
export const getShellContext = () => shellContext;

export function mount(container: HTMLElement, context: ShellContext) {
  shellContext = context;
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <MemoryRouter>
        <Routes>
          <Route path="/*" element={<MyPage />} />
        </Routes>
      </MemoryRouter>
    </React.StrictMode>
  );
  return () => { root.unmount(); shellContext = null; };
}

export const manifest = { name: 'my-plugin', version: '1.0.0', mount };
export default manifest;
```

2. **Add UMD build script:**

```json
// package.json
{
  "scripts": {
    "build:production": "tsc && vite build --config vite.config.umd.ts --mode production"
  }
}
```

3. **Create UMD Vite config:**

```typescript
// vite.config.umd.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/production',
    lib: {
      entry: './src/App.tsx',
      name: 'NaapPluginMyPlugin',
      fileName: () => 'my-plugin.js',
      formats: ['umd'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-dom/client': 'ReactDOM',
        },
      },
    },
  },
});
```

4. **Build and publish:**

```bash
cd plugins/my-plugin/frontend
npm run build:production
# Upload dist/production/ to Vercel Blob via Plugin Publisher
```

### For Platform Operators

1. **Enable CDN loading gradually:**

```typescript
import { updatePluginFeatureFlags, FLAG_PRESETS } from '@/lib/plugins/feature-flags';

// Start with canary (5%)
updatePluginFeatureFlags(FLAG_PRESETS.canary);

// Monitor metrics, then increase
updatePluginFeatureFlags(FLAG_PRESETS.limited); // 25%
updatePluginFeatureFlags(FLAG_PRESETS.wide);    // 75%
updatePluginFeatureFlags(FLAG_PRESETS.full);    // 100%
```

2. **Emergency rollback:**

```typescript
updatePluginFeatureFlags(FLAG_PRESETS.emergency);
```

3. **Configure environment variables:**

```env
ENABLE_CDN_LOADING=true
ENABLE_BLOB_STORAGE=true
CDN_ROLLOUT_PERCENT=100
BLOB_READ_WRITE_TOKEN=vercel_blob_xxx
```

## Rollback Plan

If issues are detected after migration:

### Immediate Rollback (< 1 minute)
```typescript
// Set feature flags to emergency mode
updatePluginFeatureFlags({
  enableCDNLoading: false,
  cdnLoadingRolloutPercent: 0,
});
```

### Full Rollback (< 5 minutes)
1. Set `ENABLE_CDN_LOADING=false` in Vercel env vars
2. Redeploy: `vercel --prod`
3. Module Federation plugins will be used instead

### Data Recovery
- Plugin bundles remain in Vercel Blob (no data loss)
- IndexedDB cache can be cleared: `clearPluginCache()`

## Monitoring

### Key Metrics
- Plugin load time (p50, p95, p99)
- Cache hit/miss rate
- Bundle sizes
- Error rates by plugin

### Health Checks
```typescript
// Check cache stats
const stats = await getCacheStats();
console.log('Cache hit rate:', stats.hitCount / (stats.hitCount + stats.missCount));

// Check loaded plugins
const plugins = getAllCachedUMDPlugins();
console.log('Loaded plugins:', plugins.map(p => p.name));
```

## Security Considerations

1. **CSP Headers**: All plugin pages have strict CSP
2. **Sandbox Mode**: Plugins cannot access auth tokens directly
3. **URL Validation**: Only whitelisted CDN hosts allowed
4. **Hash Verification**: Bundle hashes validated before execution

## Performance Optimizations

1. **Preloading**: Popular plugins preloaded on app init
2. **IndexedDB Cache**: Reduces CDN requests by 7x (7-day TTL)
3. **Parallel Loading**: Independent plugins load in parallel
4. **Gzip Compression**: Vercel Blob serves gzipped content

## Troubleshooting

### Plugin not loading
1. Check browser console for errors
2. Verify CDN URL is accessible
3. Check if plugin global is registered: `window.NaapPluginXxx`

### Cache issues
```javascript
// Clear plugin cache
import { clearPluginCache } from '@/lib/plugins/cache';
await clearPluginCache();

// Clear UMD module cache
import { clearUMDPluginCache } from '@/lib/plugins/umd-loader';
clearUMDPluginCache();
```

### Security errors
- Check CSP headers in Network tab
- Verify CDN host is in allowed list
- Check sandbox restrictions in console

## Files Reference

| File | Purpose |
|------|---------|
| `packages/plugin-sdk/src/umd/index.ts` | UMD SDK entry point |
| `packages/plugin-build/src/build.ts` | Plugin build logic |
| `apps/web-next/src/lib/plugins/umd-loader.ts` | Runtime loader |
| `apps/web-next/src/lib/plugins/cache.ts` | IndexedDB caching |
| `apps/web-next/src/lib/plugins/sandbox.ts` | Security sandbox |
| `apps/web-next/src/lib/plugins/csp.ts` | CSP generation |
| `apps/web-next/src/lib/plugins/feature-flags.ts` | Rollout control |
| `apps/web-next/src/components/plugin/PluginLoader.tsx` | React component |

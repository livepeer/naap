# Plugin Serverless Architecture Plan

> **Note:** This document is historical. Module Federation references in this document have been superseded -- the platform now uses **UMD/CDN exclusively** for plugin loading. The gradual rollout strategy described herein (feature flags, percentage-based rollout) is no longer needed since all plugins are UMD/CDN.

## Executive Summary

This document outlines the complete architecture for making the NaaP plugin system Vercel-compatible and production-ready. The goal is to replace the current Express-based `plugin-server` with a fully serverless solution using Vercel Blob, API Routes, and edge functions.

## Current State Analysis

### Problems with Current Architecture

1. **Express Plugin Server (port 3100)**
   - Runs as persistent process - incompatible with serverless
   - Serves from local filesystem - no persistence in Vercel
   - Dynamic HTML rewriting on each request - not scalable
   - No CDN caching - poor global performance

2. **Module Federation Limitations**
   - Vite Module Federation requires runtime ES module imports
   - Next.js cannot dynamically import external ES modules
   - Shared React scope issues across different bundlers

3. **Plugin Publisher Service**
   - Stores uploads to local filesystem
   - `frontendUrl` points to localhost URLs
   - No production deployment path

4. **Missing Production Features**
   - No CDN distribution
   - No version management
   - No rollback capability
   - No plugin analytics

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Vercel Edge                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Next.js App │  │ API Routes  │  │   Edge Middleware       │ │
│  │ (web-next)  │  │ (serverless)│  │ (auth, routing, cache)  │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                      │               │
│         └────────────────┼──────────────────────┘               │
│                          │                                       │
├──────────────────────────┼───────────────────────────────────────┤
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Plugin Registry API                       ││
│  │  /api/v1/plugins/registry  - List/search plugins            ││
│  │  /api/v1/plugins/[name]    - Get plugin manifest            ││
│  │  /api/v1/plugins/publish   - Publish new version            ││
│  │  /api/v1/plugins/install   - Install for user/team          ││
│  └─────────────────────────────────────────────────────────────┘│
│                          │                                       │
├──────────────────────────┼───────────────────────────────────────┤
│                          ▼                                       │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐ │
│  │  Vercel Blob     │  │         PostgreSQL (Neon)            │ │
│  │  (Plugin Assets) │  │  - PluginPackage                     │ │
│  │                  │  │  - PluginVersion                     │ │
│  │  /plugins/       │  │  - PluginDeployment                  │ │
│  │    {name}/       │  │  - TenantPluginInstall               │ │
│  │      {version}/  │  │  - UserPluginPreference              │ │
│  │        bundle.js │  │                                      │ │
│  │        styles.css│  └──────────────────────────────────────┘ │
│  │        index.html│                                           │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Plugin Build System Modernization

**Goal**: Update plugin build process to produce Vercel-compatible output

#### 1.1 New Plugin Build Configuration

Create a standardized build that:
- Produces a single bundle (not Module Federation remoteEntry)
- Includes all dependencies (no shared scope needed)
- Exports `mount()` as UMD/IIFE global
- Generates manifest with asset hashes

```typescript
// packages/plugin-build/src/config.ts
export interface PluginBuildConfig {
  name: string;
  entry: string;
  output: {
    format: 'umd';  // Universal Module Definition
    name: string;   // Global variable name
    dir: string;
  };
  external: string[];  // Dependencies provided by shell
  define: {
    'process.env.NODE_ENV': string;
  };
}
```

#### 1.2 Plugin Build Script

```typescript
// packages/plugin-build/src/build.ts
export async function buildPlugin(pluginDir: string): Promise<BuildResult> {
  // 1. Read plugin.json manifest
  // 2. Build with Rollup/esbuild (UMD format)
  // 3. Generate content hashes for assets
  // 4. Create production manifest with CDN URLs
  // 5. Output to dist/ with versioned paths
  
  return {
    manifest: ProductionManifest,
    assets: AssetInfo[],
    bundleHash: string,
  };
}
```

#### 1.3 Output Structure

```
plugins/{name}/dist/
├── manifest.json           # Production manifest with CDN URLs
├── {version}/
│   ├── bundle.[hash].js    # Main plugin bundle (UMD)
│   ├── styles.[hash].css   # Extracted styles
│   └── index.html          # Standalone preview page
└── latest/                 # Symlink to current version
```

### Phase 2: Vercel Blob Storage Integration

**Goal**: Store plugin assets in Vercel Blob with proper caching

#### 2.1 Plugin Storage Service

```typescript
// apps/web-next/src/lib/plugins/storage.ts
export class PluginStorage {
  private blob: VercelBlobAdapter;
  
  async uploadPlugin(
    name: string,
    version: string,
    assets: PluginAsset[]
  ): Promise<PluginDeployment> {
    const basePath = `plugins/${name}/${version}`;
    
    // Upload each asset with content-type headers
    const urls = await Promise.all(
      assets.map(asset => this.blob.upload(
        `${basePath}/${asset.filename}`,
        asset.content,
        {
          contentType: asset.contentType,
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ))
    );
    
    return {
      bundleUrl: urls.find(u => u.endsWith('.js')),
      stylesUrl: urls.find(u => u.endsWith('.css')),
      version,
      uploadedAt: new Date(),
    };
  }
  
  async deleteVersion(name: string, version: string): Promise<void> {
    // Delete all assets for a version (for rollback/cleanup)
  }
  
  getPublicUrl(path: string): string {
    return `https://${process.env.BLOB_STORE_ID}.public.blob.vercel-storage.com/${path}`;
  }
}
```

#### 2.2 CDN URL Generation

```typescript
// apps/web-next/src/lib/plugins/cdn.ts
export function getPluginCdnUrl(
  name: string,
  version: string,
  asset: 'bundle' | 'styles' | 'manifest'
): string {
  const baseUrl = process.env.PLUGIN_CDN_URL || 
    `https://${process.env.BLOB_STORE_ID}.public.blob.vercel-storage.com`;
  
  return `${baseUrl}/plugins/${name}/${version}/${asset}`;
}
```

### Phase 3: Plugin Registry API

**Goal**: Serverless API for plugin management

#### 3.1 Registry Endpoints

```
GET  /api/v1/plugins/registry
     - List available plugins (with search, category filter)
     - Returns: { plugins: PluginSummary[], total: number }

GET  /api/v1/plugins/registry/[name]
     - Get plugin details and versions
     - Returns: { plugin: PluginDetails, versions: VersionInfo[] }

GET  /api/v1/plugins/registry/[name]/[version]/manifest
     - Get specific version manifest with CDN URLs
     - Returns: ProductionManifest

POST /api/v1/plugins/publish
     - Publish new plugin version
     - Body: { manifest, assets[] } (multipart)
     - Returns: { deployment: PluginDeployment }

POST /api/v1/plugins/[name]/install
     - Install plugin for user/team
     - Body: { userId?, teamId?, config? }
     - Returns: { installation: TenantPluginInstall }

DELETE /api/v1/plugins/[name]/uninstall
     - Uninstall plugin
     - Body: { userId?, teamId? }

PUT  /api/v1/plugins/[name]/preferences
     - Update user preferences (order, pinned, enabled)
     - Body: { enabled?, order?, pinned? }
```

#### 3.2 Registry Implementation

```typescript
// apps/web-next/src/app/api/v1/plugins/registry/route.ts
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  
  const where = {
    publishStatus: 'published',
    deprecated: false,
    ...(category && { category }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };
  
  const [plugins, total] = await Promise.all([
    prisma.pluginPackage.findMany({
      where,
      include: {
        versions: {
          where: { deprecated: false },
          orderBy: { publishedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { downloads: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.pluginPackage.count({ where }),
  ]);
  
  return success({
    plugins: plugins.map(toPluginSummary),
    total,
    page,
    limit,
  });
}
```

### Phase 4: Plugin Loader (Client-Side)

**Goal**: Load plugins from CDN with proper caching and error handling

#### 4.1 UMD Plugin Loader

```typescript
// apps/web-next/src/lib/plugins/loader.ts
export interface LoadedPlugin {
  name: string;
  version: string;
  mount: (container: HTMLElement, context: ShellContext) => () => void;
}

const pluginCache = new Map<string, LoadedPlugin>();
const loadingPromises = new Map<string, Promise<LoadedPlugin>>();

export async function loadPlugin(
  manifest: ProductionManifest
): Promise<LoadedPlugin> {
  const cacheKey = `${manifest.name}@${manifest.version}`;
  
  // Check cache
  if (pluginCache.has(cacheKey)) {
    return pluginCache.get(cacheKey)!;
  }
  
  // Check if already loading
  if (loadingPromises.has(cacheKey)) {
    return loadingPromises.get(cacheKey)!;
  }
  
  const loadPromise = (async () => {
    try {
      // Load styles first (non-blocking)
      if (manifest.stylesUrl) {
        loadStyles(manifest.name, manifest.stylesUrl);
      }
      
      // Load bundle via script tag
      await loadScript(manifest.bundleUrl, manifest.name);
      
      // Get the global export
      const pluginGlobal = (window as any)[manifest.globalName];
      
      if (!pluginGlobal || typeof pluginGlobal.mount !== 'function') {
        throw new Error(`Plugin ${manifest.name} does not export mount function`);
      }
      
      const plugin: LoadedPlugin = {
        name: manifest.name,
        version: manifest.version,
        mount: pluginGlobal.mount,
      };
      
      pluginCache.set(cacheKey, plugin);
      return plugin;
    } finally {
      loadingPromises.delete(cacheKey);
    }
  })();
  
  loadingPromises.set(cacheKey, loadPromise);
  return loadPromise;
}

function loadScript(url: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (document.querySelector(`script[data-plugin="${name}"]`)) {
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = url;
    script.dataset.plugin = name;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load plugin script: ${url}`));
    document.head.appendChild(script);
  });
}

function loadStyles(name: string, url: string): void {
  // Check if already loaded
  if (document.querySelector(`link[data-plugin="${name}"]`)) {
    return;
  }
  
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.plugin = name;
  document.head.appendChild(link);
}
```

#### 4.2 Plugin Component

```typescript
// apps/web-next/src/components/plugin/PluginLoader.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { loadPlugin } from '@/lib/plugins/loader';
import { useShellServices } from '@/contexts/shell-context';
import type { ProductionManifest } from '@/lib/plugins/types';

interface PluginLoaderProps {
  manifest: ProductionManifest;
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
}

export function PluginLoader({ manifest, fallback, onError }: PluginLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const shellServices = useShellServices();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    let mounted = true;
    
    async function load() {
      try {
        const plugin = await loadPlugin(manifest);
        
        if (!mounted || !containerRef.current) return;
        
        // Mount the plugin
        cleanupRef.current = plugin.mount(containerRef.current, shellServices);
        setStatus('ready');
      } catch (err) {
        if (!mounted) return;
        
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setStatus('error');
        onError?.(error);
      }
    }
    
    load();
    
    return () => {
      mounted = false;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [manifest, shellServices, onError]);
  
  if (status === 'loading') {
    return fallback || <PluginLoadingSkeleton />;
  }
  
  if (status === 'error') {
    return <PluginErrorDisplay error={error!} manifest={manifest} />;
  }
  
  return <div ref={containerRef} className="plugin-container" />;
}
```

### Phase 5: Plugin Publish Flow

**Goal**: End-to-end serverless plugin publishing

#### 5.1 Publish API

```typescript
// apps/web-next/src/app/api/v1/plugins/publish/route.ts
import { validateSession } from '@/lib/api/auth';
import { PluginStorage } from '@/lib/plugins/storage';
import { validateManifest } from '@/lib/plugins/validator';
import { prisma } from '@/lib/db';

export async function POST(request: NextRequest) {
  // 1. Authenticate publisher
  const user = await validateSession(request);
  if (!user) return errors.unauthorized();
  
  // 2. Parse multipart form data
  const formData = await request.formData();
  const manifestFile = formData.get('manifest') as File;
  const bundleFile = formData.get('bundle') as File;
  const stylesFile = formData.get('styles') as File | null;
  
  // 3. Validate manifest
  const manifest = JSON.parse(await manifestFile.text());
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    return errors.badRequest(validation.errors);
  }
  
  // 4. Check publisher permissions
  const publisher = await prisma.publisher.findFirst({
    where: { userId: user.id },
  });
  if (!publisher && !user.roles?.includes('system:admin')) {
    return errors.forbidden('Not a registered publisher');
  }
  
  // 5. Upload assets to Vercel Blob
  const storage = new PluginStorage();
  const assets = [
    { filename: 'bundle.js', content: await bundleFile.arrayBuffer(), contentType: 'application/javascript' },
  ];
  if (stylesFile) {
    assets.push({ filename: 'styles.css', content: await stylesFile.arrayBuffer(), contentType: 'text/css' });
  }
  
  const deployment = await storage.uploadPlugin(
    manifest.name,
    manifest.version,
    assets
  );
  
  // 6. Create/update database records
  const pkg = await prisma.pluginPackage.upsert({
    where: { name: manifest.name },
    create: {
      name: manifest.name,
      displayName: manifest.displayName,
      description: manifest.description,
      category: manifest.category || 'other',
      publisherId: publisher?.id,
      publishStatus: 'published',
    },
    update: {
      displayName: manifest.displayName,
      description: manifest.description,
    },
  });
  
  const version = await prisma.pluginVersion.create({
    data: {
      packageId: pkg.id,
      version: manifest.version,
      manifest: manifest,
      frontendUrl: deployment.bundleUrl,
      releaseNotes: manifest.releaseNotes || '',
    },
  });
  
  // 7. Create deployment record
  await prisma.pluginDeployment.upsert({
    where: { packageId: pkg.id },
    create: {
      packageId: pkg.id,
      versionId: version.id,
      status: 'running',
      frontendUrl: deployment.bundleUrl,
    },
    update: {
      versionId: version.id,
      frontendUrl: deployment.bundleUrl,
    },
  });
  
  return success({
    package: pkg,
    version,
    deployment,
  });
}
```

#### 5.2 CLI Publish Command

```typescript
// packages/plugin-cli/src/commands/publish.ts
export async function publishPlugin(options: PublishOptions) {
  const spinner = ora('Building plugin...').start();
  
  // 1. Build plugin
  const buildResult = await buildPlugin(options.pluginDir, {
    format: 'umd',
    minify: true,
  });
  spinner.text = 'Build complete';
  
  // 2. Prepare upload
  const formData = new FormData();
  formData.append('manifest', new Blob([JSON.stringify(buildResult.manifest)], { type: 'application/json' }));
  formData.append('bundle', new Blob([buildResult.bundle], { type: 'application/javascript' }));
  if (buildResult.styles) {
    formData.append('styles', new Blob([buildResult.styles], { type: 'text/css' }));
  }
  
  // 3. Publish
  spinner.text = 'Publishing...';
  const response = await fetch(`${options.registryUrl}/api/v1/plugins/publish`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${options.token}`,
    },
    body: formData,
  });
  
  if (!response.ok) {
    throw new Error(`Publish failed: ${await response.text()}`);
  }
  
  spinner.succeed(`Published ${buildResult.manifest.name}@${buildResult.manifest.version}`);
}
```

### Phase 6: Database Schema Updates

#### 6.1 Add CDN Fields

```prisma
// packages/database/prisma/schema.prisma

model PluginVersion {
  id            String   @id @default(uuid())
  packageId     String
  version       String
  manifest      Json
  
  // CDN URLs (production)
  bundleUrl     String?  // Vercel Blob URL for bundle.js
  stylesUrl     String?  // Vercel Blob URL for styles.css
  sourcemapUrl  String?  // Optional sourcemap for debugging
  
  // Legacy (deprecated)
  frontendUrl   String?  @deprecated
  backendImage  String?  @deprecated
  
  // Metadata
  bundleSize    Int?     // Bundle size in bytes
  bundleHash    String?  // Content hash for cache validation
  
  releaseNotes  String   @default("")
  deprecated    Boolean  @default(false)
  deprecationMsg String?
  downloads     Int      @default(0)
  publishedAt   DateTime @default(now())
  
  package       PluginPackage @relation(fields: [packageId], references: [id])
  deployments   PluginDeployment[]
  
  @@unique([packageId, version])
}

model PluginDeployment {
  id            String   @id @default(uuid())
  packageId     String   @unique
  versionId     String
  
  status        String   @default("running")
  
  // CDN URLs
  bundleUrl     String   // Active bundle URL
  stylesUrl     String?
  
  // Legacy (deprecated)
  frontendUrl   String?  @deprecated
  backendUrl    String?  @deprecated
  containerPort Int?     @deprecated
  
  healthStatus  String?
  activeInstalls Int     @default(0)
  deployedAt    DateTime @default(now())
  
  package       PluginPackage @relation(fields: [packageId], references: [id])
  version       PluginVersion @relation(fields: [versionId], references: [id])
}
```

### Phase 7: Security Considerations

#### 7.1 Plugin Sandboxing

```typescript
// apps/web-next/src/lib/plugins/sandbox.ts
export interface PluginSandbox {
  // Restricted APIs available to plugins
  api: {
    fetch: typeof fetch;  // Proxied through Next.js API routes
    storage: StorageAPI;   // Scoped to plugin namespace
    events: EventBus;      // Filtered event bus
  };
  
  // Blocked APIs
  // - Direct DOM manipulation outside container
  // - localStorage/sessionStorage (use storage API)
  // - Cookies
  // - History manipulation
  // - window.open (use navigation API)
}

export function createPluginContext(
  manifest: ProductionManifest,
  shellServices: ShellContext
): PluginContext {
  return {
    // Scoped auth (read-only user info)
    auth: {
      getUser: () => sanitizeUser(shellServices.auth.getUser()),
      isAuthenticated: () => shellServices.auth.isAuthenticated(),
    },
    
    // Scoped navigation
    navigate: (path: string) => {
      // Validate path is within plugin's routes
      if (!isPluginRoute(path, manifest.routes)) {
        console.warn(`Plugin ${manifest.name} tried to navigate outside its routes`);
        return;
      }
      shellServices.navigate(path);
    },
    
    // Scoped notifications
    notifications: shellServices.notifications,
    
    // Scoped API client
    api: createScopedApiClient(manifest.name),
    
    // Theme (read-only)
    theme: {
      mode: shellServices.theme.mode,
      colors: shellServices.theme.colors,
      onChange: shellServices.theme.onChange,
    },
  };
}
```

#### 7.2 Content Security Policy

```typescript
// apps/web-next/src/middleware.ts
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  
  // Plugin CDN URLs
  const pluginCdnOrigin = process.env.BLOB_STORE_ID 
    ? `https://${process.env.BLOB_STORE_ID}.public.blob.vercel-storage.com`
    : '';
  
  // CSP for plugins
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-eval' ${pluginCdnOrigin}`,  // Plugins need eval for UMD
    `style-src 'self' 'unsafe-inline' ${pluginCdnOrigin}`,
    `img-src 'self' data: blob: ${pluginCdnOrigin}`,
    `connect-src 'self' ${pluginCdnOrigin}`,
    `frame-src 'none'`,  // No iframes for plugins
  ].join('; ');
  
  response.headers.set('Content-Security-Policy', csp);
  
  return response;
}
```

### Phase 8: Caching Strategy

#### 8.1 CDN Cache Headers

```typescript
// Plugin assets are immutable (content-hashed)
const CACHE_HEADERS = {
  bundle: 'public, max-age=31536000, immutable',  // 1 year
  styles: 'public, max-age=31536000, immutable',  // 1 year
  manifest: 'public, max-age=300',                 // 5 minutes
};
```

#### 8.2 Client-Side Caching

```typescript
// apps/web-next/src/lib/plugins/cache.ts
export class PluginCache {
  private static DB_NAME = 'naap-plugins';
  private static STORE_NAME = 'manifests';
  
  async getManifest(name: string): Promise<ProductionManifest | null> {
    // Try IndexedDB first (offline support)
    const cached = await this.getFromIndexedDB(name);
    if (cached && !this.isExpired(cached)) {
      return cached.manifest;
    }
    
    // Fetch from API
    const manifest = await this.fetchManifest(name);
    if (manifest) {
      await this.saveToIndexedDB(name, manifest);
    }
    
    return manifest;
  }
  
  async preloadPlugins(names: string[]): Promise<void> {
    // Preload manifests in parallel
    await Promise.all(names.map(name => this.getManifest(name)));
  }
}
```

### Phase 9: Migration Path

#### 9.1 Migration Steps

1. **Parallel Operation** (Week 1-2)
   - Deploy new CDN-based plugin loading alongside existing
   - Feature flag: `PLUGIN_CDN_ENABLED`
   - Both systems active, gradually migrate plugins

2. **Plugin Rebuild** (Week 2-3)
   - Update each plugin's build config for UMD output
   - Test with new loader
   - Publish to Vercel Blob

3. **Database Migration** (Week 3)
   - Add new CDN URL fields
   - Migrate existing `frontendUrl` to `bundleUrl`
   - Deprecate old fields

4. **Cutover** (Week 4)
   - Switch feature flag to CDN-only
   - Remove Express plugin-server
   - Monitor for issues

5. **Cleanup** (Week 5)
   - Remove deprecated code
   - Update documentation
   - Archive old plugin builds

#### 9.2 Rollback Plan

The system supports gradual rollout and instant rollback via environment variables:

**Environment Variables for Cutover:**

| Variable | Values | Description |
|----------|--------|-------------|
| `PLUGIN_CDN_ENABLED` | `true`/`false` | Master switch for CDN plugin loading |
| `PLUGIN_LEGACY_ENABLED` | `true`/`false` | Allow legacy Module Federation plugins |
| `ENABLE_BLOB_STORAGE` | `true`/`false` | Enable Vercel Blob storage for uploads |
| `CDN_ROLLOUT_PERCENT` | `0-100` | Percentage of users to enable CDN loading |
| `FORCE_CDN_PLUGINS` | `plugin1,plugin2` | Comma-separated list of plugins to always load via CDN |
| `FORCE_LEGACY_PLUGINS` | `plugin1,plugin2` | Comma-separated list of plugins to always load via legacy |

**Rollout Procedure:**

1. **Stage 1 - Testing (5%):**
   ```bash
   PLUGIN_CDN_ENABLED=true
   PLUGIN_LEGACY_ENABLED=true
   CDN_ROLLOUT_PERCENT=5
   ```

2. **Stage 2 - Expanded (25%):**
   ```bash
   CDN_ROLLOUT_PERCENT=25
   ```

3. **Stage 3 - Majority (75%):**
   ```bash
   CDN_ROLLOUT_PERCENT=75
   ```

4. **Stage 4 - Full (100%):**
   ```bash
   CDN_ROLLOUT_PERCENT=100
   ```

5. **Stage 5 - Legacy Disabled:**
   ```bash
   PLUGIN_LEGACY_ENABLED=false
   ```

**Rollback Procedure:**

To immediately rollback to legacy Module Federation:
```bash
PLUGIN_CDN_ENABLED=false
PLUGIN_LEGACY_ENABLED=true
```

Or to rollback a specific plugin:
```bash
FORCE_LEGACY_PLUGINS=problematic-plugin
```

**Code Path:**

```typescript
// apps/web-next/src/lib/plugins/feature-flags.ts
export function shouldUseCDNLoading(pluginName: string, userId?: string): boolean {
  const flags = getPluginFeatureFlags();
  
  // Force legacy for specific plugins
  if (flags.forceLegacyPlugins.includes(pluginName)) return false;
  
  // Force CDN for specific plugins
  if (flags.forceCDNPlugins.includes(pluginName)) return true;
  
  // Master CDN switch
  if (!flags.enableCDNLoading) return false;
  
  // Rollout percentage with consistent user hashing
  return hashCode(userId + pluginName) % 100 < flags.cdnLoadingRolloutPercent;
}
```

## Implementation Checklist

### Phase 1: Build System
- [ ] Create `packages/plugin-build` package
- [ ] Implement UMD build configuration
- [ ] Update plugin vite.config.ts templates
- [ ] Test build output with existing plugins

### Phase 2: Storage
- [ ] Implement `PluginStorage` class
- [ ] Add Vercel Blob integration tests
- [ ] Configure CDN headers

### Phase 3: Registry API
- [ ] Create registry API routes
- [ ] Implement manifest caching
- [ ] Add search/filter functionality
- [ ] Add rate limiting

### Phase 4: Plugin Loader
- [ ] Implement UMD loader
- [ ] Add error boundaries
- [ ] Add retry logic
- [ ] Add loading states

### Phase 5: Publish Flow
- [ ] Create publish API endpoint
- [ ] Implement validation
- [ ] Create CLI tool
- [ ] Add CI/CD integration

### Phase 6: Database
- [ ] Create migration for new fields
- [ ] Update Prisma schema
- [ ] Migrate existing data

### Phase 7: Security
- [ ] Implement plugin sandboxing
- [ ] Configure CSP headers
- [ ] Add permission validation

### Phase 8: Caching
- [ ] Configure CDN cache headers
- [ ] Implement client-side caching
- [ ] Add preloading logic

### Phase 9: Migration
- [ ] Add feature flags
- [ ] Create migration scripts
- [ ] Test rollback procedure
- [ ] Document changes

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Build System | 3-4 days | None |
| Phase 2: Storage | 2 days | Phase 1 |
| Phase 3: Registry API | 3 days | Phase 2 |
| Phase 4: Plugin Loader | 2 days | Phase 1 |
| Phase 5: Publish Flow | 3 days | Phase 2, 3 |
| Phase 6: Database | 1 day | None |
| Phase 7: Security | 2 days | Phase 4 |
| Phase 8: Caching | 1 day | Phase 3, 4 |
| Phase 9: Migration | 3-5 days | All |

**Total: ~3-4 weeks**

## Success Metrics

1. **Performance**
   - Plugin load time < 500ms (CDN edge)
   - Time to interactive < 1s

2. **Reliability**
   - 99.9% plugin availability
   - Zero downtime deployments

3. **Developer Experience**
   - `npm run build:plugin` works reliably
   - `naap-cli publish` completes in < 30s
   - Clear error messages

4. **Cost**
   - Vercel Blob storage within limits
   - No persistent server costs

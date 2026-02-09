# NAAP Production Readiness Guide

This guide provides everything you need to prepare the NAAP platform for production deployment, including multi-tenant personalization, observability, and security.

---

## Table of Contents

1. [Overview](#overview)
2. [Multi-Tenant Personalization](#multi-tenant-personalization)
3. [Observability](#observability)
4. [Security](#security)
5. [Performance](#performance)
6. [Deployment Checklist](#deployment-checklist)

---

## Overview

NAAP is a plugin-based platform that supports multi-tenant configurations, allowing each user (tenant) to have personalized plugin experiences. The platform provides:

- **Tenant-scoped plugin configurations** - Each user can have their own settings for each plugin
- **Team context** - Organizations can share plugins with team-wide and personal config overrides
- **Distributed observability** - Tracing, metrics, and structured logging across all services
- **Security hardening** - CSP, CSRF protection, input validation, and kill switches

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Shell (Frontend)                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
│  │ Plugin  │  │ Plugin  │  │ Plugin  │  │ TenantContext   │ │
│  │ A       │  │ B       │  │ C       │  │ TeamContext     │ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘ │
└───────┼────────────┼────────────┼────────────────┼──────────┘
        │            │            │                │
        v            v            v                v
┌─────────────────────────────────────────────────────────────┐
│                      Base Service (API)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Tenant       │  │ Team         │  │ Admin            │   │
│  │ Middleware   │  │ Middleware   │  │ Routes           │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│                          │                                   │
│                          v                                   │
│              ┌──────────────────────┐                       │
│              │ Database (Prisma)    │                       │
│              └──────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Multi-Tenant Personalization

### What It Enables

Multi-tenant personalization allows:

1. **Per-user plugin experiences** - Each user sees different featured plugins, banners, or defaults
2. **Tenant-scoped configurations** - Plugin settings stored per-user installation
3. **Auto-detection of context** - Plugins automatically detect if they're running in a tenant, team, or personal context
4. **Admin governance** - Admins can view, edit, or approve tenant configurations

### How It Works

#### Tenant Context in the Shell

The shell provides a `TenantContext` that tracks the current tenant installation:

```typescript
interface TenantContextState {
  currentInstallation: TenantInstallation | null;
  isTenantContext: boolean;
  setCurrentPlugin: (pluginName: string | null) => Promise<void>;
  refreshInstallation: () => Promise<void>;
  isLoading: boolean;
}
```

#### Using Tenant Context in Plugins

Plugins can access tenant context via SDK hooks:

```typescript
import { useTenantContext, usePluginConfig } from '@naap/plugin-sdk';

function MyPluginSettings() {
  const { isTenantContext, currentInstallation } = useTenantContext();
  
  // Auto-detects scope (personal, team, or tenant)
  const { config, updateConfig, currentScope } = usePluginConfig({
    pluginName: 'my-plugin',
    defaults: { theme: 'dark', notifications: true },
    scope: 'auto',
  });

  return (
    <div>
      <p>Running in: {currentScope} scope</p>
      {isTenantContext && (
        <p>Tenant installation: {currentInstallation?.id}</p>
      )}
      <Toggle
        checked={config.notifications}
        onChange={(v) => updateConfig({ notifications: v })}
      />
    </div>
  );
}
```

#### Marketplace Personalization Example

The marketplace plugin demonstrates tenant personalization:

```typescript
interface MarketplaceConfig {
  featuredPlugins: string[];       // Plugins to highlight
  welcomeBanner?: {
    enabled: boolean;
    title: string;
    message: string;
    variant: 'info' | 'success' | 'warning';
  };
  hiddenPlugins: string[];         // Plugins to hide from this tenant
  showPricingTiers: boolean;
  defaultCategory: string;
}
```

With this config, admins can:
- Feature specific plugins for specific tenants
- Show custom welcome banners
- Hide plugins that aren't relevant to a tenant
- Set default category views

### Admin Governance

Admins can manage tenant configurations via the admin API:

```
GET    /api/v1/admin/tenants                    # List all tenants
GET    /api/v1/admin/tenants/:id                # Get tenant details
PATCH  /api/v1/admin/tenants/:id/status         # Enable/disable tenant
GET    /api/v1/admin/tenants/:id/installations  # List tenant's plugins
PUT    /api/v1/admin/tenants/:id/installations/:id/config  # Update config
POST   /api/v1/admin/tenants/:id/installations/:id/approve # Approve/reject
GET    /api/v1/admin/audit-logs                 # View audit trail
```

All admin actions are logged for compliance and auditing.

---

## Observability

### Tracing

Distributed tracing is provided via `@naap/utils/tracing`:

```typescript
import { initTracing, createSpan, withSpan, tracingMiddleware } from '@naap/utils';

// Initialize at service startup
initTracing({
  serviceName: 'base-svc',
  serviceVersion: '1.0.0',
});

// Add middleware for automatic request tracing
app.use(tracingMiddleware());

// Create spans for custom operations
await withSpan('load-plugin', async (span) => {
  span.setAttribute('plugin.name', pluginName);
  const plugin = await loadPlugin(pluginName);
  span.setAttribute('plugin.version', plugin.version);
  return plugin;
});
```

Trace context is automatically propagated via `traceparent` header (W3C Trace Context format).

### Metrics

Prometheus-compatible metrics are available via `@naap/utils/metrics`:

```typescript
import { 
  createMetricsMiddleware, 
  recordPluginLoad, 
  recordPluginError,
  exportMetrics,
} from '@naap/utils';

// Add metrics middleware
app.use(createMetricsMiddleware());

// Expose /metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(exportMetrics());
});

// Record custom metrics
recordPluginLoad('my-plugin', 150); // 150ms load time
recordPluginError('my-plugin', 'TypeError');
```

#### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `naap_plugin_load_time` | Histogram | Plugin load time in ms |
| `naap_plugin_error_total` | Counter | Plugin errors by type |
| `naap_plugin_active` | Gauge | Currently loaded plugins |
| `naap_http_requests_total` | Counter | HTTP requests by status |
| `naap_http_request_duration` | Histogram | Request duration in ms |

### Structured Logging

Use the structured logger for consistent log formats:

```typescript
import { defaultLogger } from '@naap/utils';

defaultLogger.info('Plugin loaded', {
  pluginName: 'my-plugin',
  version: '1.0.0',
  loadTime: 150,
});

defaultLogger.error('Plugin failed to load', error, {
  pluginName: 'my-plugin',
  correlationId: req.correlationId,
});
```

Log output is JSON-formatted for easy parsing:

```json
{
  "level": "info",
  "message": "Plugin loaded",
  "pluginName": "my-plugin",
  "version": "1.0.0",
  "loadTime": 150,
  "timestamp": "2026-01-29T10:30:00.000Z"
}
```

---

## Security

### Content Security Policy (CSP)

CSP is configured in `nginx/naap.conf`:

```nginx
add_header Content-Security-Policy-Report-Only "...";  # During testing
add_header Content-Security-Policy "...";              # In production
```

Monitor violations at `/api/v1/csp-report`.

### CSRF Protection

All mutating API calls require CSRF tokens:

```typescript
import { createCsrfMiddleware } from '@naap/utils';

// Add to all /api routes
app.use('/api', createCsrfMiddleware({
  skipPaths: ['/api/v1/health', '/api/v1/csp-report'],
}));
```

The SDK's `useApiClient` automatically includes CSRF tokens.

### Input Validation

Use Zod schemas for validation:

```typescript
import { validate, schemas } from '@naap/utils';

app.post('/api/v1/plugins', 
  validate({
    body: schemas.publishPlugin,
  }),
  async (req, res) => {
    // req.body is validated and typed
  }
);
```

### Plugin Kill Switch

Remotely disable plugins without deployment:

```typescript
import { activateKillSwitch, isPluginEnabled } from '@naap/utils';

// Admin triggers kill switch
activateKillSwitch('risky-plugin', 'Security vulnerability', 'admin@example.com');

// Shell checks before loading
if (!isPluginEnabled('risky-plugin')) {
  console.warn('Plugin disabled by kill switch');
  return;
}
```

---

## Performance

### Bundle Size

- Use dynamic imports for heavy components
- Enable tree shaking in Vite config
- Monitor bundle size with `naap-plugin build`

### Caching

- Plugin manifests are cached in the shell
- API responses should include appropriate cache headers
- Use Redis/Memcached for session and config caching in production

---

## Deployment Checklist

### Before Go-Live

- [ ] CSP switched from report-only to enforcing
- [ ] CSRF enforcement enabled (`CSRF_ENFORCE=true`)
- [ ] Input validation on all endpoints
- [ ] Tracing and metrics endpoints exposed
- [ ] Structured logging enabled
- [ ] Kill switch tested and accessible to admins
- [ ] Admin audit logs verified
- [ ] Performance benchmarks met
- [ ] Security scan completed

### Monitoring Setup

- [ ] Prometheus scraping `/metrics` endpoints
- [ ] Tracing collector configured (Jaeger/Zipkin/OTLP)
- [ ] Log aggregation (ELK/Loki) set up
- [ ] Alerts configured for:
  - High error rates
  - Slow response times
  - CSP violations
  - Failed plugin loads

---

## Next Steps

- See [QUICKSTART.md](../QUICKSTART.md) for developer onboarding
- See [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) for common issues
- See [PLUGIN_SECURITY_MODEL.md](../PLUGIN_SECURITY_MODEL.md) for security details

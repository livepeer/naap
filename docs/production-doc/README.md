# NAAP Production Documentation

This folder contains production-grade documentation for the NAAP platform.

---

## Quick Links

### Getting Started
- [QUICKSTART.md](../QUICKSTART.md) - 5-minute developer onboarding
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) - Common issues and solutions

### Production Readiness
- [PRODUCTION_READINESS_GUIDE.md](./PRODUCTION_READINESS_GUIDE.md) - Complete production guide
  - Multi-tenant personalization
  - Observability (tracing, metrics, logging)
  - Security hardening
  - Deployment checklist

### Architecture & Security
- [PLUGIN_SECURITY_MODEL.md](../PLUGIN_SECURITY_MODEL.md) - Plugin isolation and permissions
- [architecture.md](../architecture.md) - System architecture overview

### API & SDK
- [plugin-developer-guide.md](../plugin-developer-guide.md) - Full plugin development guide
- [SDK Hooks Reference](../../packages/plugin-sdk/src/hooks/index.ts) - Available SDK hooks

---

## What's New

### Phase 1: Tenant Personalization
- **Tenant Context** - Plugins can detect and use tenant-scoped configurations
- **Auto-detection** - `usePluginConfig` automatically detects the right scope (personal/team/tenant)
- **Marketplace Personalization** - Featured plugins, banners, and hidden plugins per tenant

### Phase 2: Architecture Improvements
- **Centralized Error Handling** - `createErrorHandler` middleware for consistent errors
- **Structured Logging** - JSON-formatted logs with correlation IDs
- **Error Types** - `AppError`, `ValidationError`, `NotFoundError`, etc.

### Phase 3: Observability
- **Distributed Tracing** - `createSpan`, `withSpan`, `tracingMiddleware`
- **Prometheus Metrics** - `/metrics` endpoint with plugin and HTTP metrics
- **Request Context** - Automatic correlation ID propagation

### Admin & Governance
- **Admin API** - Manage tenants, installations, and configurations
- **Audit Logging** - All admin actions logged for compliance
- **Kill Switch** - Remotely disable plugins without deployment

---

## SDK Hook Quick Reference

### Authentication
```typescript
import { useAuthService } from '@naap/plugin-sdk';

const auth = useAuthService();
const user = auth.getUser();
const token = await auth.getToken();
```

### API Calls
```typescript
import { useApiClient } from '@naap/plugin-sdk';

const api = useApiClient({ pluginName: 'my-plugin' });
const data = await api.get('/api/v1/data');
await api.post('/api/v1/data', { value: 123 });
```

### Tenant Configuration
```typescript
import { usePluginConfig, useTenantContext } from '@naap/plugin-sdk';

// Auto-detect scope
const { config, updateConfig, currentScope } = usePluginConfig({
  pluginName: 'my-plugin',
  defaults: { theme: 'dark' },
  scope: 'auto',
});

// Check tenant context
const { isTenantContext, currentInstallation } = useTenantContext();
```

### Capabilities
```typescript
import { useCapabilities, useCapability } from '@naap/plugin-sdk';

const hasAI = useCapability('ai');
const capabilities = useCapabilities();
if (capabilities.has('storage')) {
  // Use storage features
}
```

### Notifications
```typescript
import { useNotify } from '@naap/plugin-sdk';

const notify = useNotify();
notify.success('Saved!');
notify.error('Failed to save');
notify.info('Processing...');
```

### Navigation
```typescript
import { useNavigate } from '@naap/plugin-sdk';

const navigate = useNavigate();
navigate('/my-plugin/settings');
```

---

## CLI Commands

```bash
# Create a new plugin
naap-plugin create my-plugin

# Start development
naap-plugin dev              # Plugin only
naap-plugin dev --with-shell # Plugin + shell + backends

# Diagnose issues
naap-plugin doctor

# Build for production
naap-plugin build

# Package for publishing
naap-plugin package

# Publish to registry
naap-plugin publish
```

---

## Support

- GitHub Issues: Report bugs and feature requests
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md): Self-service issue resolution

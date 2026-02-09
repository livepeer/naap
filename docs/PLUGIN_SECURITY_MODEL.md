# Plugin Security Model

This document describes the security model for NAAP plugins, including trust levels, isolation modes, and best practices.

## Trust Model

NAAP uses a **trust by installation** model:

1. **Plugins from verified publishers** are considered trusted
2. **Plugins from the marketplace** should declare their isolation mode
3. **Dev mode plugins** run without isolation for development convenience

### Trust Levels

| Trust Level | Description | Default Isolation |
|-------------|-------------|-------------------|
| Trusted | Published by verified organization | `none` |
| Untrusted | Third-party or community plugins | `iframe` recommended |
| Dev | Local development plugins | `none` |

## Isolation Modes

Plugins can declare their isolation mode in `plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "isolation": "none" | "iframe" | "worker"
}
```

### Mode: `none` (Default)

- Plugin runs in the same JavaScript context as the shell
- Has access to the full `ShellContext` API
- Can access `window`, `document`, and `localStorage`
- **Use for:** Trusted first-party plugins

**Security Implications:**
- Plugin can read authentication tokens
- Plugin can modify other plugins' DOM
- Plugin can intercept network requests

### Mode: `iframe`

- Plugin runs in a sandboxed iframe
- Communicates with shell via `postMessage`
- Cannot access parent `window` or `localStorage`
- **Use for:** Third-party marketplace plugins

**Security Benefits:**
- Full JavaScript isolation
- Cannot access host authentication
- Cannot modify host DOM
- Resource limits via CSP

**Sandbox Attributes:**
- Untrusted: `allow-scripts allow-forms` (no `allow-same-origin`)
- Trusted: `allow-scripts allow-same-origin allow-forms`

### Mode: `worker` (Future)

- Plugin runs in a Web Worker
- Maximum isolation with structured cloning for data
- No DOM access (backend-style plugins)
- **Use for:** Data processing plugins

## Plugin Permissions

Plugins declare required permissions in `plugin.json`:

```json
{
  "permissions": {
    "shell": ["navigation", "notifications", "theme"],
    "apis": ["my-wallet:read"],
    "external": ["https://api.example.com/*"]
  }
}
```

### Shell Permissions

| Permission | Description |
|------------|-------------|
| `navigation` | Can navigate to other routes |
| `notifications` | Can show toast notifications |
| `theme` | Can read/change theme |
| `auth` | Can access user information |
| `events` | Can emit/listen to event bus |
| `integrations` | Can use AI/Storage/Email services |

### API Permissions

Declare which other plugin APIs this plugin can call:

```json
"apis": ["my-wallet:read", "marketplace:*"]
```

### External Permissions

Declare which external URLs the plugin can access:

```json
"external": ["https://api.openai.com/*", "https://storage.example.com/*"]
```

## Content Security Policy (CSP)

The shell enforces CSP headers to prevent XSS and injection attacks:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' http://localhost:*;
  connect-src 'self' http://localhost:* https://api.naap.io;
  frame-src 'self' http://localhost:*;
```

**Note:** CSP runs in report-only mode during Phase 0-3. Violations are logged to `/api/v1/csp-report`.

## CSRF Protection

All state-changing API requests require a CSRF token:

```typescript
// SDK automatically includes CSRF token
const api = useApiClient({ pluginName: 'my-plugin' });
await api.post('/resources', data); // CSRF token included
```

## Best Practices for Plugin Authors

### 1. Declare Appropriate Isolation

```json
// For trusted first-party plugins
{ "isolation": "none" }

// For third-party plugins
{ "isolation": "iframe" }
```

### 2. Request Minimal Permissions

Only request permissions you actually need:

```json
{
  "permissions": {
    "shell": ["navigation"],  // Only what's needed
    "apis": [],               // No cross-plugin access
    "external": []            // No external requests
  }
}
```

### 3. Handle Sandboxed Environment

If your plugin might run sandboxed, use the sandbox client API:

```javascript
// In sandboxed plugin
window.parent.postMessage({
  type: 'sandbox:navigate',
  pluginName: 'my-plugin',
  payload: '/target-route'
}, '*');
```

### 4. Validate User Input

Always validate and sanitize user input:

```typescript
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

const validated = schema.parse(userInput);
```

### 5. Use SDK Services

Use SDK-provided services instead of direct access:

```typescript
// Good: Use SDK
const { user } = useAuth();

// Bad: Direct access (may not work in sandbox)
const token = localStorage.getItem('auth_token');
```

## Security Checklist for Plugin Authors

- [ ] Declare appropriate `isolation` mode
- [ ] Request only necessary permissions
- [ ] Validate all user inputs
- [ ] Use HTTPS for external requests
- [ ] Don't store sensitive data in localStorage
- [ ] Handle errors gracefully without exposing internals
- [ ] Test with CSP enabled
- [ ] Follow secure coding practices

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do not** open a public issue
2. Email security@naap.io with details
3. Include steps to reproduce
4. Allow 90 days for fix before disclosure

## Version History

- **Phase 0**: Initial security model with CSP report-only and isolation modes
- **Phase 4**: CSP enforcing mode, permission prompts, security scanning

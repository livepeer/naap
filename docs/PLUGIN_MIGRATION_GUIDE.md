# Plugin Migration Guide

This guide helps plugin developers migrate from the legacy patterns to the new SDK-based approach.

## Overview

The new SDK provides:
- Standardized mount/unmount lifecycle with `createPluginMount()`
- React hooks for accessing shell services (`useShell()`, `useAuth()`, `useNotify()`)
- Error boundary component for graceful error handling
- Type-safe access to all shell services

## Migration Checklist

- [ ] Replace manual mount logic with `createPluginMount()` or `createPlugin()`
- [ ] Wrap app with `ShellProvider`
- [ ] Replace `getShellContext()` calls with SDK hooks
- [ ] Remove `as any` type casts
- [ ] Add `PluginErrorBoundary` for error handling
- [ ] Test all functionality

## Before vs After

### Mount Function (Before)

```typescript
// Old pattern - lots of boilerplate
import ReactDOM from 'react-dom/client';
import type { ShellContext } from '@naap/plugin-sdk';
import App from './App';

let shellContext: ShellContext | null = null;
export const getShellContext = () => shellContext;

export const manifest = {
  name: 'my-plugin',
  version: '1.0.0',
  routes: ['/my-plugin', '/my-plugin/*'],
  
  mount(container: HTMLElement, context: ShellContext) {
    shellContext = context;
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <MemoryRouter>
          <Routes>
            <Route path="/*" element={<App />} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>
    );
    return () => {
      root.unmount();
      shellContext = null;
    };
  },
};
```

### Mount Function (After)

```typescript
// New pattern - minimal boilerplate
import { createPlugin, ShellProvider, PluginErrorBoundary } from '@naap/plugin-sdk';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import App from './App';

export const manifest = createPlugin({
  name: 'my-plugin',
  version: '1.0.0',
  routes: ['/my-plugin', '/my-plugin/*'],
  App: () => (
    <MemoryRouter>
      <Routes>
        <Route path="/*" element={<App />} />
      </Routes>
    </MemoryRouter>
  ),
});
```

### Accessing Shell Context (Before)

```typescript
// Old pattern - manual context access with type casting
import { getShellContext } from './App';

function MyComponent() {
  const shell = getShellContext();
  
  // Type-unsafe access
  const user = shell?.auth?.getUser();
  const team = (shell as any)?.team;
  
  const handleAction = () => {
    shell?.notifications?.success('Done!');
  };
  
  return (
    <div>
      <p>User: {user?.displayName}</p>
      <button onClick={handleAction}>Do Something</button>
    </div>
  );
}
```

### Accessing Shell Context (After)

```typescript
// New pattern - hooks with full type safety
import { useAuth, useNotify, useTeam } from '@naap/plugin-sdk';

function MyComponent() {
  const auth = useAuth();
  const notify = useNotify();
  const team = useTeam();
  
  const user = auth.getUser();
  
  const handleAction = () => {
    notify.success('Done!');
  };
  
  return (
    <div>
      <p>User: {user?.displayName}</p>
      <button onClick={handleAction}>Do Something</button>
    </div>
  );
}
```

## Step-by-Step Migration

### Step 1: Update App.tsx

Remove the manual context storage:

```diff
- let shellContext: ShellContext | null = null;
- export const getShellContext = () => shellContext;
```

### Step 2: Update Mount Function

Replace the manual mount with `createPlugin()`:

```typescript
import { createPlugin } from '@naap/plugin-sdk';

export const manifest = createPlugin({
  name: 'my-plugin',
  version: '1.0.0',
  routes: ['/my-plugin', '/my-plugin/*'],
  App: MyPluginApp,
  // Optional: Add initialization logic
  onInit: async (context) => {
    // Pre-load config, establish connections, etc.
  },
  onMount: (context) => {
    // Called after mount
  },
  onUnmount: () => {
    // Cleanup
  },
});
```

### Step 3: Replace getShellContext() with Hooks

Find all usages of `getShellContext()` and replace with appropriate hooks:

| Old Pattern | New Pattern |
|------------|-------------|
| `getShellContext()` | `useShell()` |
| `shell?.auth` | `useAuth()` |
| `shell?.notifications` | `useNotify()` |
| `shell?.eventBus` | `useEvents()` |
| `shell?.theme` | `useThemeService()` |
| `shell?.navigate` | `useNavigate()` |
| `(shell as any)?.team` | `useTeam()` |
| `(shell as any)?.tenant` | `useTenant()` |

### Step 4: Add Error Boundary

Wrap your app with `PluginErrorBoundary`:

```typescript
import { PluginErrorBoundary } from '@naap/plugin-sdk';

function MyPluginApp() {
  return (
    <PluginErrorBoundary pluginName="my-plugin">
      <Routes>
        <Route path="/*" element={<MainContent />} />
      </Routes>
    </PluginErrorBoundary>
  );
}
```

### Step 5: Remove Type Casts

Replace `as any` casts with proper types:

```diff
- const team = (shell as any)?.team;
+ const team = useTeam();

- const config = (shell as any)?.pluginConfig?.[pluginName];
+ const { config } = usePluginConfig({ pluginName, defaults: {} });
```

## Hook Reference

### Core Hooks

```typescript
// Access the full shell context
const shell = useShell();

// Authentication
const auth = useAuth();
const user = auth.getUser();
const isLoggedIn = auth.isAuthenticated();

// Notifications
const notify = useNotify();
notify.success('Operation completed');
notify.error('Something went wrong');

// Navigation
const navigate = useNavigate();
navigate('/some-path');

// Events
const events = useEvents();
events.emit('my-event', { data: 'value' });
events.on('other-event', (data) => console.log(data));
```

### Team Hooks

```typescript
// Get team context
const team = useTeam();
const currentTeam = useCurrentTeam();
const isTeamContext = useIsTeamContext();
const role = useTeamRole();

// Permission checks
const canManage = useCanManageMembers();
const canInstall = useCanInstallPlugins();
```

### Integration Hooks

```typescript
// AI
const ai = useAI();
const result = await ai.complete('Write a haiku');

// Storage
const storage = useStorage();
const uploaded = await storage.upload(file, 'path/to/file');

// Email
const email = useEmail();
await email.send({ email: 'user@example.com' }, 'Subject', 'Body');
```

## Common Pitfalls

### 1. Hooks Outside ShellProvider

**Problem**: Using hooks outside of `ShellProvider` throws an error.

**Solution**: Ensure your app is wrapped with `ShellProvider`. If using `createPlugin()`, this is done automatically.

### 2. Accessing Context in Non-React Code

**Problem**: Need shell context in utility functions or API calls.

**Solution**: Use `getContext()` from `createPluginMount()`:

```typescript
const { mount, getContext } = createPluginMount({ App: MyApp });

// In utility function
function makeApiCall() {
  const shell = getContext();
  const token = await shell?.auth.getToken();
  // ...
}
```

### 3. Missing Navigation in Plugin Mode

**Problem**: `useNavigate()` from react-router-dom only works within the plugin.

**Solution**: Use shell's navigate for cross-plugin navigation:

```typescript
const shellNavigate = useNavigate(); // from @naap/plugin-sdk
shellNavigate('/other-plugin/path'); // Navigate anywhere in shell
```

## Testing Migrated Plugins

After migration, verify:

1. **Mount/Unmount**: Plugin loads and unloads cleanly
2. **Authentication**: User info displays correctly
3. **Notifications**: Success/error messages appear
4. **Navigation**: Links work within and outside plugin
5. **Team Context**: Team-specific data loads if applicable
6. **Error Handling**: Errors are caught by error boundary

## Need Help?

If you encounter issues during migration:

1. Check the console for error messages
2. Verify `ShellProvider` is wrapping your app
3. Ensure all hooks are called inside React components
4. Review the SDK source code in `packages/plugin-sdk/src/`

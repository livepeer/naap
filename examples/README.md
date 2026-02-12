# NAAP Plugin Examples

This directory contains example plugins to help developers get started building NAAP plugins.

## Available Examples

### Reference Plugins (moved from `plugins/`)

The following full-featured plugins have been moved here from the `plugins/`
directory. They serve as **reference implementations** that demonstrate
full-stack plugin development but are **not deployed by default**. They are
excluded from builds, the marketplace seed, and CI matrices.

| Directory | Description |
|-----------|-------------|
| `gateway-manager/` | AI gateway infrastructure monitoring |
| `orchestrator-manager/` | Livepeer orchestrator management |
| `network-analytics/` | Network analytics & leaderboard |
| `my-wallet/` | MetaMask wallet / LPT staking |
| `daydream-video/` | Real-time AI video (StreamDiffusion) |
| `my-dashboard/` | Embedded Metabase dashboards |

To use one of these plugins in a local dev environment, copy it back into
`plugins/` and restart:

```bash
cp -r examples/gateway-manager plugins/gateway-manager
bin/start.sh
```

---

### 1. Hello World (Frontend Only)

A minimal plugin demonstrating shell service integration without a backend.

**Location**: `hello-world/`

**Features**:
- User authentication state
- Theme integration
- Notification system
- Event bus usage

**Quick Start**:
```bash
cd hello-world/frontend
npm install
npm run dev
# Runs on port 3020
```

### 2. Todo List (Full Stack)

A complete plugin with frontend, backend, and RBAC.

**Location**: `todo-list/`

**Features**:
- Express.js backend API
- CRUD operations
- Role-based access control
- Token validation with shell

**Quick Start**:
```bash
# Start backend
cd todo-list/backend
npm install
npm run dev
# Runs on port 4021

# Start frontend (in another terminal)
cd todo-list/frontend
npm install
npm run dev
# Runs on port 3021
```

## Registering Dev Plugins

To test example plugins with the shell, add them to localStorage:

```javascript
// Open browser console on localhost:3000
localStorage.setItem('naap-dev-plugins', JSON.stringify([
  // Hello World
  {
    name: 'helloWorld',
    displayName: 'Hello World',
    remoteUrl: 'http://localhost:3020/dist/production/helloWorld.js',
    routes: ['/hello', '/hello/*'],
    icon: 'Hand',
    enabled: true
  },
  // Todo List
  {
    name: 'todoList',
    displayName: 'Todo List',
    remoteUrl: 'http://localhost:3021/dist/production/todoList.js',
    routes: ['/todos', '/todos/*'],
    icon: 'CheckSquare',
    enabled: true
  }
]));

// Refresh the page
location.reload();
```

## Plugin Structure

### Frontend-Only Plugin

```
my-plugin/
├── plugin.json           # Plugin manifest
├── README.md
└── frontend/
    ├── src/
    │   ├── App.tsx       # Entry point & manifest export
    │   └── globals.css
    ├── package.json
    ├── tsconfig.json
    └── vite.config.ts    # UMD/CDN build config
```

### Full-Stack Plugin

```
my-plugin/
├── plugin.json           # Plugin manifest with backend config
├── README.md
├── frontend/
│   ├── src/...
│   ├── package.json
│   └── vite.config.ts
└── backend/
    ├── src/
    │   └── server.ts     # Express/Fastify server
    ├── package.json
    └── tsconfig.json
```

## Key Files

### plugin.json

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "category": "productivity",
  "icon": "Puzzle",
  "routes": ["/my-route", "/my-route/*"],
  "frontend": {
    "devPort": 3022,
    "entryPoint": "./frontend/src/App.tsx"
  },
  "backend": {
    "devPort": 4022,
    "entryPoint": "./backend/src/server.ts"
  },
  "rbac": {
    "roles": [
      {
        "name": "my-plugin:admin",
        "displayName": "My Plugin Admin",
        "permissions": [
          { "resource": "my-plugin", "action": "*" }
        ]
      }
    ]
  }
}
```

### Frontend App.tsx

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { ShellContext, WorkflowManifest } from '@naap/types';

let shellContext: ShellContext | null = null;
export const getShellContext = () => shellContext;

export const manifest: WorkflowManifest = {
  name: 'myPlugin',
  version: '1.0.0',
  routes: ['/my-route', '/my-route/*'],
  mount(container: HTMLElement, context: ShellContext) {
    shellContext = context;
    const root = ReactDOM.createRoot(container);
    root.render(<App />);
    return () => { root.unmount(); shellContext = null; };
  },
};

export const mount = manifest.mount;
export default manifest;
```

### vite.config.ts

```ts
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  pluginName: 'myPlugin',
});
```

## Shell Services Available

| Service | Access Method | Description |
|---------|---------------|-------------|
| User | `shellContext.user()` | Get current user info |
| Auth Token | `shellContext.authToken()` | Get JWT for API calls |
| Navigate | `shellContext.navigate(path)` | Programmatic routing |
| Theme | `shellContext.theme` | Current theme settings |
| Events | `shellContext.eventBus` | Cross-plugin events |
| Notifications | `eventBus.emit('notification:show', {...})` | Show toast messages |

## Creating a New Plugin

1. **Copy an example** as your starting point:
   ```bash
   cp -r examples/hello-world plugins/my-plugin
   ```

2. **Update plugin.json** with your plugin info

3. **Update vite.config.ts** with unique name

4. **Develop your plugin**:
   ```bash
   cd plugins/my-plugin/frontend
   npm install
   npm run dev
   ```

5. **Register as dev plugin** (see above)

6. **Build for production**:
   ```bash
   npm run build
   # Output in dist/production/<plugin-name>.js
   ```

## Documentation

- [Plugin Developer Guide](../docs/plugin-developer-guide.md)
- [Shell Overview](../docs/shell-overview.md)
- [Plugin SDK Reference](../packages/plugin-sdk/README.md)

## License

MIT

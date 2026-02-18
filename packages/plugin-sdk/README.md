# @naap/plugin-sdk

The official SDK for building plugins on the NAAP (Network as a Platform) ecosystem.

## Installation

```bash
npm install @naap/plugin-sdk
```

## Quick Start

```bash
# Create a new plugin
npx naap-plugin create my-plugin

# Start development
cd my-plugin
npx naap-plugin dev
```

## Documentation

See the comprehensive **[Developer Guide](./DEVELOPER_GUIDE.md)** for:

- **Quick Start** - Create your first plugin in minutes
- **Core Concepts** - Architecture, manifests, multi-tenancy
- **API Reference** - All hooks, types, and components
- **CLI Reference** - Complete command documentation
- **Cookbook** - Common patterns and recipes
- **Migration Guide** - Upgrading from SDK 1.x to 2.0
- **Troubleshooting** - Common issues and solutions

## Features

- **React Hooks** - Type-safe access to shell services (auth, notifications, events)
- **Event Bus** - Plugin-to-plugin communication with request/response pattern
- **Multi-Tenancy** - Built-in support for user and team contexts
- **Plugin API** - Simplified backend communication
- **Configuration** - Multi-level config with merge strategies
- **CLI Tools** - Create, develop, test, build, deploy plugins
- **AI-Assisted Development** - Generate and iterate on plugins with AI

## Basic Usage

The canonical way to create a NAAP plugin is with `createPlugin()`:

```typescript
// App.tsx
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import Dashboard from './pages/Dashboard';

const MyPluginApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<Dashboard />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'my-plugin',
  version: '1.0.0',
  routes: ['/my-plugin', '/my-plugin/*'],
  App: MyPluginApp,
});

export const mount = plugin.mount;
export default plugin;
```

Inside your components, use SDK hooks for shell integration:

```typescript
import {
  useAuth,
  useNotify,
  usePluginEvent,
  usePluginApi,
  usePluginConfig,
} from '@naap/plugin-sdk';

function Dashboard() {
  const { user, isAuthenticated } = useAuth();
  const notify = useNotify();
  const api = usePluginApi();
  const { config } = usePluginConfig();

  // Listen for events
  usePluginEvent('theme:change', (data) => {
    console.log('Theme changed:', data.mode);
  });

  const handleClick = async () => {
    const result = await api.post('/items', { name: 'New Item' });
    notify.success('Item created!');
  };

  return (
    <div>
      <h1>Welcome, {user?.displayName}</h1>
      <button onClick={handleClick}>Create Item</button>
    </div>
  );
}
```

## For Plugin Developers

You only need two packages:

- **`@naap/plugin-sdk`** — Runtime SDK (hooks, `createPlugin`, types, utilities, HTTP headers)
- **`@naap/plugin-build`** — Build tooling (Vite config via `createPluginConfig`, UMD bundling)

Other `@naap/*` packages (`@naap/types`, `@naap/ui`, `@naap/theme`, etc.) are optional — their core plugin-facing types and constants are re-exported from `@naap/plugin-sdk`.

```json
{
  "dependencies": {
    "@naap/plugin-sdk": "workspace:*"
  },
  "devDependencies": {
    "@naap/plugin-build": "workspace:*"
  }
}
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `create` | Create a new plugin from template |
| `dev` | Start development server with hot reload |
| `build` | Build plugin for production |
| `test` | Run plugin tests |
| `publish` | Publish plugin to registry |
| `deploy` | Deploy plugin to production |
| `generate` | AI-assisted plugin generation |
| `iterate` | AI-assisted code modification |

## Requirements

- Node.js 20+
- React 18+
- TypeScript 5+

## License

MIT

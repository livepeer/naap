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

```typescript
import {
  useAuth,
  useNotify,
  usePluginEvent,
  usePluginApi,
  usePluginConfig,
} from '@naap/plugin-sdk';

function MyPlugin() {
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

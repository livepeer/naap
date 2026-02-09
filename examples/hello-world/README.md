# Hello World Plugin

A minimal example plugin demonstrating how to integrate with NAAP shell services.

## Features Demonstrated

- **User Authentication**: Reading user state from shell context
- **Theme Integration**: Respecting shell theme settings
- **Notifications**: Emitting notification events via event bus
- **Event Bus**: Sending and receiving custom events

## Quick Start

```bash
# Install dependencies
cd frontend && npm install

# Run in development mode
npm run dev
```

The plugin will run on port 3020. Register it in the shell by adding to your dev plugins:

```bash
# In shell-web, add to localStorage
localStorage.setItem('naap-dev-plugins', JSON.stringify([
  {
    name: 'helloWorld',
    displayName: 'Hello World',
    remoteUrl: 'http://localhost:3020/production/helloWorld.js',
    routes: ['/hello', '/hello/*'],
    icon: 'Hand',
    enabled: true
  }
]));
```

## Code Structure

```
hello-world/
├── plugin.json           # Plugin manifest
├── README.md             # This file
└── frontend/
    ├── src/
    │   ├── App.tsx       # Main plugin code
    │   └── globals.css   # Plugin styles
    ├── package.json
    ├── tsconfig.json
    └── vite.config.ts
```

## Using Shell Context

```tsx
import type { ShellContext } from '@naap/types';

// Store context from mount
let shellContext: ShellContext | null = null;

// In your component
const user = shellContext?.user();
const theme = shellContext?.theme;

// Navigate
shellContext?.navigate('/settings');

// Emit notification
shellContext?.eventBus.emit('notification:show', {
  message: 'Hello!',
  type: 'success'
});
```

## License

MIT
